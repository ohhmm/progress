import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from webdriver import Driver, wait_for

BASE = os.environ.get("BASE", "http://127.0.0.1:8123/index.html")

def run():
    d = Driver()
    d.cleanup_sessions()
    d.new_session()
    d.navigate(BASE)
    time.sleep(1)
    title = d.title()
    print("title:", title)
    assert "Progress" in title, title
    # create task
    btn = d.find("css selector", "#new-task")
    d.click(btn)
    time.sleep(0.5)
    inp = d.find("css selector", "#task-title")
    d.send_keys(inp, "Smoke task")
    # submit
    submit = d.find("css selector", "#task-form button[type='submit']")
    d.click(submit)
    time.sleep(0.5)
    # check card
    cards = d.find_all("css selector", ".card h3")
    print("cards:", [d.text(c) for c in cards])
    assert any(d.text(c) == "Smoke task" for c in cards), "card not created"
    # edit
    edit = d.find("css selector", ".card .ghost")
    d.click(edit)
    time.sleep(0.5)
    t = d.find("css selector", "#task-title")
    d.clear(t)
    d.send_keys(t, "Smoke task edited")
    submit = d.find("css selector", "#task-form button[type='submit']")
    d.click(submit)
    time.sleep(0.5)
    cards = d.find_all("css selector", ".card h3")
    print("cards after edit:", [d.text(c) for c in cards])
    assert any(d.text(c) == "Smoke task edited" for c in cards)
    # delete
    delbtn = d.find("css selector", ".card .ghost.danger")
    d.click(delbtn)
    time.sleep(0.5)
    confirm = d.find("css selector", "#delete-confirm")
    d.click(confirm)
    time.sleep(0.5)
    cards = d.find_all("css selector", ".card")
    print("cards after delete:", len(cards))
    assert len(cards) == 0
    # export dialog opens
    exp = d.find("css selector", "#export-data")
    d.click(exp)
    time.sleep(0.5)
    area = d.find("css selector", "#import-text")
    print("export value len:", len(d.prop(area, "value")))
    close = d.find("css selector", "#close-import")
    d.click(close)
    time.sleep(0.3)
    d.delete_session()
    print("SMOKE OK")

if __name__ == "__main__":
    run()
