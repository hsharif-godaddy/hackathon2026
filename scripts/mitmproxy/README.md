# Using mitmproxy

- Install on macOS: `brew install mitmproxy`
- Modify your `.env` to change the `GOCODE_BASE_URL` to `http://localhost:8080`.
- Run `./mitmproxy-gocode.sh` which will open a browser to view requests
- Run application as usual

You should now see requests in the mitmproxy web view.

Modify the `gocode-random-error.py` to enable various test scenarios. `mitmproxy` will automatically reload it on change.
