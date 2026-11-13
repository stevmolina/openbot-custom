### Fixed

- The web app no longer stutters on iPad and iPhone while the keyboard opens or while Safari moves the page as you type. Before, each step of the keyboard animation made the browser restyle the whole app, about 80 ms per frame on an iPad layout.
- Style changes in the web app and the desktop app are faster in newer WebKit versions, because a stylesheet rule for old browsers no longer applies to every element.

### Changed

- The web app loads the styles of workflows and routine diagrams only when it shows them, so the first load downloads less CSS.
