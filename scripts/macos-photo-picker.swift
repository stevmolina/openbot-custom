// The macOS photo picker of the desktop app: the system Photos grid (PHPickerViewController).
//
// The main process starts this program when the user chooses Photos in the "+" menu of a message
// box (`src/main/macos-photo-picker.ts`). The picker runs out of process in macOS, so this program
// needs no Photos permission and no entitlement. It shows the grid in its own window, as an
// accessory app with no Dock icon, copies each chosen photo or video into the output folder, and
// prints one line of JSON on stdout:
//
//   {"status":"picked","files":[{"path":"/out/0/IMG_0001.jpg"}],"failed":0}
//   {"status":"cancelled"}
//   {"status":"error","message":"..."}
//
// Photos come in the compatible representation, so a HEIC photo arrives as a JPEG. A photo that
// still has another format is written again as a JPEG, because the chat takes only the image types
// in `IMAGE_ATTACHMENT_EXTENSIONS`.
//
// Arguments: --out <folder> [--videos] [--video-types mov,mp4] [--limit <1-100>] [--title <window title>]
//            [--self-test <file>]   exports one file with no window, for `scripts/macos-photo-picker-e2e.ts`
// SIGUSR1 brings the open picker to the front: the app sends it when the user chooses Photos again.
//
// `scripts/build-macos-photo-picker.ts` compiles it for macOS 13 and later.
import AppKit
import Foundation
import ImageIO
import PhotosUI
import UniformTypeIdentifiers

let supportedImageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "avif"]

struct Options {
    var output: URL?
    var videos = false
    /** The video types that the host takes. Another video is left out and counted as failed. */
    var videoTypes: Set<String> = ["mov", "mp4"]
    var limit = 10
    var title = "Photos"
    var selfTest: URL?
}

func parseOptions(_ arguments: [String]) -> Options? {
    var options = Options()
    var index = 0
    while index < arguments.count {
        let argument = arguments[index]
        let value = index + 1 < arguments.count ? arguments[index + 1] : nil
        switch argument {
        case "--out":
            guard let value else { return nil }
            options.output = URL(fileURLWithPath: value, isDirectory: true)
            index += 1
        case "--videos":
            options.videos = true
        case "--video-types":
            guard let value else { return nil }
            options.videoTypes = Set(value.split(separator: ",").map { $0.lowercased() })
            index += 1
        case "--limit":
            guard let value, let limit = Int(value), (1...100).contains(limit) else { return nil }
            options.limit = limit
            index += 1
        case "--title":
            guard let value else { return nil }
            options.title = value
            index += 1
        case "--self-test":
            guard let value else { return nil }
            options.selfTest = URL(fileURLWithPath: value)
            index += 1
        default:
            return nil
        }
        index += 1
    }
    return options.output == nil ? nil : options
}

func printResult(_ object: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func finish(_ object: [String: Any], code: Int32 = 0) -> Never {
    printResult(object)
    exit(code)
}

/// A file name that is safe in one folder: no path separators, no leading dot, not empty.
func safeBaseName(_ suggested: String?, fallback: String) -> String {
    let cleaned = (suggested ?? "")
        .components(separatedBy: CharacterSet(charactersIn: "/:\\\0").union(.controlCharacters))
        .joined(separator: "-")
        .trimmingCharacters(in: CharacterSet(charactersIn: ". ").union(.whitespaces))
    let base = cleaned.isEmpty ? fallback : cleaned
    return String(base.prefix(120))
}

/// Writes the image at `source` again as a JPEG. Answers false when ImageIO cannot read it.
func writeJPEG(from source: URL, to destination: URL) -> Bool {
    guard let image = CGImageSourceCreateWithURL(source as CFURL, nil),
          let output = CGImageDestinationCreateWithURL(destination as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { return false }
    CGImageDestinationAddImageFromSource(output, image, 0, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    return CGImageDestinationFinalize(output)
}

/// Copies the file that the provider delivers into `folder`. The delivered file is deleted when the
/// handler returns, so the copy happens inside it.
func export(
    _ provider: NSItemProvider,
    index: Int,
    videos: Bool,
    videoTypes: Set<String>,
    into root: URL,
    completion: @escaping (URL?) -> Void
) {
    let isVideo = videos && provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
    guard isVideo || provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
        completion(nil)
        return
    }
    let type = isVideo ? UTType.movie : UTType.image
    _ = provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { delivered, _ in
        guard let delivered else {
            completion(nil)
            return
        }
        let folder = root.appendingPathComponent(String(index), isDirectory: true)
        let fileManager = FileManager.default
        do {
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completion(nil)
            return
        }
        let base = safeBaseName(
            provider.suggestedName ?? delivered.deletingPathExtension().lastPathComponent,
            fallback: isVideo ? "video-\(index + 1)" : "photo-\(index + 1)"
        )
        var fileExtension = delivered.pathExtension.lowercased()
        if fileExtension == "m4v" { fileExtension = "mp4" }
        if !isVideo && !supportedImageExtensions.contains(fileExtension) {
            let destination = folder.appendingPathComponent(base).appendingPathExtension("jpg")
            completion(writeJPEG(from: delivered, to: destination) ? destination : nil)
            return
        }
        if isVideo && !videoTypes.contains(fileExtension) {
            completion(nil)
            return
        }
        let destination = folder.appendingPathComponent(base).appendingPathExtension(fileExtension)
        do {
            try fileManager.copyItem(at: delivered, to: destination)
            completion(destination)
        } catch {
            completion(nil)
        }
    }
}

/// Exports the providers in their order, then prints the result and exits.
func exportAll(_ providers: [NSItemProvider], options: Options) -> Never {
    let group = DispatchGroup()
    var exported = [URL?](repeating: nil, count: providers.count)
    let lock = NSLock()
    for (index, provider) in providers.enumerated() {
        group.enter()
        export(provider, index: index, videos: options.videos, videoTypes: options.videoTypes, into: options.output!) { url in
            lock.lock()
            exported[index] = url
            lock.unlock()
            group.leave()
        }
    }
    group.wait()
    let files = exported.compactMap { $0 }
    finish([
        "status": "picked",
        "files": files.map { ["path": $0.path] },
        "failed": providers.count - files.count,
    ])
}

final class PickerController: NSObject, PHPickerViewControllerDelegate, NSWindowDelegate {
    let options: Options
    var window: NSPanel?
    var finished = false

    init(options: Options) {
        self.options = options
    }

    func show() {
        var configuration = PHPickerConfiguration()
        configuration.selectionLimit = options.limit
        configuration.selection = .ordered
        configuration.preferredAssetRepresentationMode = .compatible
        configuration.filter = options.videos ? .any(of: [.images, .videos]) : .images
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        // A panel that takes clicks without activating this app. macOS does not let a program that the
        // front app started take the focus from it, so a normal window would spend the first click on it.
        let window = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 820, height: 580),
            styleMask: [.titled, .closable, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        window.becomesKeyOnlyIfNeeded = false
        window.hidesOnDeactivate = false
        window.title = options.title
        window.contentViewController = picker
        window.setContentSize(NSSize(width: 820, height: 580))
        window.minSize = NSSize(width: 480, height: 360)
        window.delegate = self
        window.isReleasedWhenClosed = false
        // The app that started the picker is in front. Float above it, also when macOS keeps it active.
        window.level = .floating
        window.center()
        self.window = window
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        guard !finished else { return }
        finished = true
        window?.orderOut(nil)
        if results.isEmpty { finish(["status": "cancelled"]) }
        let providers = results.map(\.itemProvider)
        // The exports call back on other queues; waiting here keeps the run loop out of the way.
        DispatchQueue.global(qos: .userInitiated).async { [options] in
            exportAll(providers, options: options)
        }
    }

    func windowWillClose(_ notification: Notification) {
        guard !finished else { return }
        finished = true
        finish(["status": "cancelled"])
    }
}

guard let options = parseOptions(Array(CommandLine.arguments.dropFirst())) else {
    finish(["status": "error", "message": "Invalid arguments."], code: 2)
}

if let fixture = options.selfTest {
    guard let provider = NSItemProvider(contentsOf: fixture) else {
        finish(["status": "error", "message": "The self-test file cannot be read."], code: 1)
    }
    provider.suggestedName = fixture.deletingPathExtension().lastPathComponent
    exportAll([provider], options: options)
}

// The picker quits with the app that started it: a parent that goes away leaves this process to launchd.
let parent = getppid()
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
    if getppid() != parent { exit(0) }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let controller = PickerController(options: options)
DispatchQueue.main.async { controller.show() }
// The app asks for the picker again while it is open, perhaps behind another window: show it.
signal(SIGUSR1, SIG_IGN)
let frontRequest = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
frontRequest.setEventHandler {
    guard !controller.finished, let window = controller.window else { return }
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
}
frontRequest.resume()
application.run()
