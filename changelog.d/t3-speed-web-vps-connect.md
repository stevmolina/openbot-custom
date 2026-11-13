### Changed

- The web app opens a far server about 3 seconds sooner. It connects to the last server while it reads the server list, asks for the session and its first ticket in one step, and opens the connection to Signal at once.
- The first reads of a server answer in one round trip. The server compresses large answers, requests no longer carry the full feature list each time, and the first reads go out with the last sign-in step. **Update the server too, to get the faster reads.**
