# Taskflow

A standalone browser-based Kanban task tracker prototype.

## Run

Open `index.html` in Chrome, Edge, Firefox, or Safari.

## Test with Safari WebDriver

Close Safari, then:

```sh
python3 -m http.server 8123 &
safaridriver -p 4444 &
BASE=http://127.0.0.1:8123/index.html python3 -m tests.browser.smoke
BASE=http://127.0.0.1:8123/index.html python3 -m tests.browser.journey
```

## Features

- create, edit, and delete tasks
- three statuses: Backlog, Doing, Done
- priority, due date, tag, and notes
- local persistence with `localStorage`
- search, filtering, sorting, and project statistics
- JSON textarea import/export
- drag and drop between columns
- keyboard shortcuts: `/` focus search, `N` new task, `Esc` close modal
