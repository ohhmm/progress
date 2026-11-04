"""A minimal W3C WebDriver client, for safaridriver, on the standard library.

There is no browser in the test environment, and there is no `pip
install` here either, so this speaks the WebDriver protocol over
`http.client`: enough of it to open a Safari session, drive it, and read
it back. It is deliberately small — a defect found in a browser has to
become an automated use-case, and the use-case should say what it does
rather than how the protocol works.

Two things about Safari are worth knowing before using it:

  * `safaridriver` serves one session at a time, and it can only open
    that session when Safari itself is not already running. A Safari
    window left open is the most common reason a session times out.
  * A session that is not deleted is a session that blocks the next
    one, so the ids are written down and cleaned up on the way in.

    python3 -m tests.browser.journey --help
"""

import base64
import http.client
import json
import os
import subprocess
import tempfile
import time

HOST = os.environ.get("GC_WD_HOST", "127.0.0.1")
PORT = int(os.environ.get("GC_WD_PORT", "4444"))

#: Where the ids of sessions that were opened are written down, so that
#: a session left behind by a run that died is closed before the next.
REGISTRY = os.path.join(tempfile.gettempdir(), "gc-wd-sessions.txt")

#: The key WebDriver uses for an element, in the W3C protocol.
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"


def safari_running():
    """Whether Safari is open.

    `safaridriver` opens its session in a Safari that is not already
    running, and a Safari that is already running is the most common
    reason a session times out.
    """
    proc = subprocess.run(["pgrep", "-x", "Safari"],
                          capture_output=True, text=True)
    return proc.returncode == 0


def quit_safari(seconds=15):
    """Ask Safari to close, and wait for it to go."""
    subprocess.run(["osascript", "-e", 'tell application "Safari" to quit'],
                   capture_output=True, text=True)
    end = time.time() + seconds
    while time.time() < end:
        if not safari_running():
            return True
        time.sleep(0.5)
    return not safari_running()


class Driver:
    """A Safari session, and the commands the journey needs."""

    def __init__(self, host=None, port=None):
        self.host = host or HOST
        self.port = port or PORT
        self.sid = None

    # -- the wire ---------------------------------------------------------

    def _req(self, method, path, body=None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=120)
        headers = {"Content-Type": "application/json; charset=utf-8",
                   "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        conn.request(method, path, body=data, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        try:
            out = json.loads(raw.decode("utf-8"))
        except ValueError:
            out = {"raw": raw.decode("utf-8", "replace")[:2000]}
        if resp.status >= 400:
            raise RuntimeError("%s %s -> %s %s" % (method, path, resp.status, out))
        return out

    def cmd(self, method, suffix, body=None):
        return self._req(method, "/session/%s%s" % (self.sid, suffix), body)

    def get(self, suffix):
        return self.cmd("GET", suffix)

    def post(self, suffix, body=None):
        return self.cmd("POST", suffix, body if body is not None else {})

    def delete(self, suffix):
        return self.cmd("DELETE", suffix)

    # -- the session ------------------------------------------------------

    def _registry(self):
        try:
            with open(REGISTRY) as handle:
                return [line.strip() for line in handle if line.strip()]
        except OSError:
            return []

    def cleanup_sessions(self):
        """Close the sessions that an earlier run left open."""
        for sid in self._registry():
            try:
                self._req("DELETE", "/session/%s" % sid)
                print("closed a session left over from an earlier run")
            except Exception:
                pass
        try:
            open(REGISTRY, "w").close()
        except OSError:
            pass

    def new_session(self, caps=None, attempts=3):
        """Open a session, and try again if Safari will not.

        Safari is asked to open a session in a Safari that is not
        already running, and it sometimes answers "the session timed
        out while connecting to a Safari instance" — the window is
        still starting, or the last session has not finished closing.
        That is the driver's own timing, not the site's, so the
        session is asked for again rather than reported as a failure
        of the product.
        """
        self.cleanup_sessions()
        payload = {"capabilities": {"alwaysMatch": caps or {}}}
        # A Safari that was already open when the driver started is
        # somebody's own, and it is not closed here: `safaridriver`
        # needs a Safari that is not already running, and the answer to
        # that is to close it, not for a test tool to close it for them.
        ours = not safari_running()
        last = None
        for attempt in range(attempts):
            # A session that timed out leaves a Safari open, and a
            # Safari that is open is the one thing that stops the next
            # attempt from working. The one the attempt just failed
            # left behind is the driver's own, and it is closed before
            # the next try.
            if attempt and ours and safari_running():
                quit_safari()
            try:
                result = self._req("POST", "/session", payload)
            except RuntimeError as err:
                last = err
                if not ours:
                    raise RuntimeError(
                        "Safari was already running when the driver "
                        "started, and safaridriver can only open a "
                        "session in a Safari that is not already open. "
                        "Close it and try again. (%s)" % err)
                time.sleep(2.0 + attempt * 2.0)
                continue
            self.sid = (result.get("value", {}).get("sessionId")
                        or result.get("sessionId"))
            if not self.sid:
                raise RuntimeError("no session id: %r" % result)
            try:
                with open(REGISTRY, "a") as handle:
                    handle.write(self.sid + "\n")
            except OSError:
                pass
            return result
        raise RuntimeError("no session after %d attempts: %s"
                           % (attempts, last))

    def delete_session(self):
        if self.sid:
            try:
                self._req("DELETE", "/session/%s" % self.sid)
            except Exception:
                pass
            self.sid = None

    # -- the page ---------------------------------------------------------

    def navigate(self, url):
        return self.post("/url", {"url": url})

    def current_url(self):
        return self.get("/url")["value"]

    def title(self):
        return self.get("/title")["value"]

    def script(self, script, args=None):
        result = self.post("/execute/sync", {"script": script, "args": args or []})
        return result.get("value")

    def set_window_rect(self, width, height):
        return self.post("/window/rect", {"width": width, "height": height})

    def window_rect(self):
        return self.get("/window/rect")["value"]

    def source(self):
        return self.get("/source")["value"]

    def screenshot(self, path):
        result = self.get("/screenshot")
        with open(path, "wb") as handle:
            handle.write(base64.b64decode(result["value"]))
        return path

    # -- the elements -----------------------------------------------------

    @staticmethod
    def _element_id(found):
        if isinstance(found, dict):
            if ELEMENT_KEY in found:
                return found[ELEMENT_KEY]
            return list(found.values())[0]
        return found

    def find(self, using, value):
        found = self.post("/element", {"using": using, "value": value})["value"]
        return self._element_id(found)

    def find_all(self, using, value):
        found = self.post("/elements", {"using": using, "value": value})["value"]
        return [self._element_id(item) for item in (found or [])]

    def click(self, element_id):
        return self.post("/element/%s/click" % element_id, {})

    def send_keys(self, element_id, text):
        return self.post("/element/%s/value" % element_id, {"text": text})

    def clear(self, element_id):
        return self.post("/element/%s/clear" % element_id, {})

    def attr(self, element_id, name):
        return self.get("/element/%s/attribute/%s" % (element_id, name))["value"]

    def prop(self, element_id, name):
        return self.get("/element/%s/property/%s" % (element_id, name))["value"]

    def text(self, element_id):
        return self.get("/element/%s/text" % element_id)["value"]

    def displayed(self, element_id):
        return self.get("/element/%s/displayed" % element_id)["value"]

    def tag_name(self, element_id):
        return self.get("/element/%s/name" % element_id)["value"]

    def css(self, element_id, name):
        return self.get("/element/%s/css/%s" % (element_id, name))["value"]

    def rect(self, element_id):
        return self.get("/element/%s/rect" % element_id)["value"]

    # -- the waits --------------------------------------------------------

    def set_script_timeout(self, ms):
        return self.post("/timeouts", {"script": ms})

    def set_page_load_timeout(self, ms):
        return self.post("/timeouts", {"pageLoad": ms})


def wait_for(condition, timeout=15.0, interval=0.25):
    """Wait for a condition, and return what it returned.

    The last value is returned rather than `None` when the wait times
    out, so a caller can report what it saw rather than just that it
    timed out. An exception raised by the condition counts as a value
    that was not true yet, and is retried.
    """
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            last = condition()
            if last:
                return last
        except Exception as err:
            last = err
        time.sleep(interval)
    return last if last and not isinstance(last, Exception) else None
