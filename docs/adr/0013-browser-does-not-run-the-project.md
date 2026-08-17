# Browser does not start the project

Browser opens a URL or local page, takes over links from the 主会话, and holds 批注. It does not detect project type or spawn `npm` / `cargo` / `go`.

A ▶ run button was rejected: the plugin does not know the right command. Starting the page is the 主会话's job (it can read the repo) or the human's in Terminal (if they know the command). Side Chat may read scripts and 投递 "把页面起起来" — it still must not spawn the process itself.
