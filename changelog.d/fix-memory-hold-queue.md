### Fixed

- A server in a container no longer holds every new message after its file cache grows. The memory guard now counts the page cache that the kernel can take back as free memory, as `MemAvailable` does. The server must also be on the new version.
- A side thread that waits for server memory now says so and lists its queued messages. Before, it said that it waited for a free thread and showed no messages.
