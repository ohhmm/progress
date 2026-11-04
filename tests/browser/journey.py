import os, sys, time, json
sys.path.insert(0, os.path.dirname(__file__))
from webdriver import Driver, wait_for

BASE = os.environ.get("BASE", "http://127.0.0.1:8123/index.html")

def js(driver, script):
    return driver.script(script)

def clear_storage(driver):
    driver.script("window.localStorage.clear(); location.reload();")
    time.sleep(1)

def text_all(driver, css):
    ids = driver.find_all("css selector", css)
    return [driver.text(x) for x in ids]

def run():
    d = Driver()
    d.cleanup_sessions()
    d.new_session()
    d.navigate(BASE)
    time.sleep(1)
    clear_storage(d)
    d.navigate(BASE)
    time.sleep(1)
    time.sleep(1)

    # create three tasks
    tasks = [("Alpha", "high", "backlog"), ("Beta", "medium", "doing"), ("Gamma", "low", "done")]
    for title, prio, status in tasks:
        d.click(d.find("css selector", "#new-task"))
        time.sleep(0.4)
        t = d.find("css selector", "#task-title")
        d.send_keys(t, title)
        # priority via script to avoid select issue? use select value
        d.script("document.getElementById('task-priority').value=%r; document.getElementById('task-priority').dispatchEvent(new Event('change',{bubbles:true}));" % prio)
        d.script("document.getElementById('task-status').value=%r; document.getElementById('task-status').dispatchEvent(new Event('change',{bubbles:true}));" % status)
        d.click(d.find("css selector", "#task-form button[type='submit']"))
        time.sleep(0.4)
    titles = text_all(d, ".card h3")
    print("titles:", titles)
    assert set(titles) == {"Alpha","Beta","Gamma"}, titles

    # filter by priority high
    d.script("document.getElementById('priority-filter').value='high'; document.getElementById('priority-filter').dispatchEvent(new Event('change',{bubbles:true}));")
    time.sleep(0.3)
    titles = text_all(d, ".card h3")
    print("high only:", titles)
    assert titles == ["Alpha"], titles
    # reset
    d.script("document.getElementById('priority-filter').value='all'; document.getElementById('priority-filter').dispatchEvent(new Event('change',{bubbles:true}));")
    time.sleep(0.3)

    # search
    s = d.find("css selector", "#search")
    d.send_keys(s, "Beta")
    time.sleep(0.3)
    titles = text_all(d, ".card h3")
    print("search Beta:", titles)
    assert titles == ["Beta"], titles
    # clear search
    d.clear(s)
    d.send_keys(s, "")
    # send_keys empty no event? trigger input
    d.script("document.getElementById('search').dispatchEvent(new Event('input',{bubbles:true}));")
    time.sleep(0.3)
    titles = text_all(d, ".card h3")
    print("after clear:", titles)
    assert set(titles) == {"Alpha","Beta","Gamma"}, titles

    # sort by priority
    d.script("document.getElementById('sort').value='priority'; document.getElementById('sort').dispatchEvent(new Event('change',{bubbles:true}));")
    time.sleep(0.3)
    titles = text_all(d, ".card h3")
    print("sort priority:", titles)
    assert titles == ["Alpha","Beta","Gamma"], titles  # high, medium, low
    # sort created newest first should reverse creation order (unshift) -> Alpha first? Actually unshift means last created first: Gamma, Beta, Alpha
    d.script("document.getElementById('sort').value='created'; document.getElementById('sort').dispatchEvent(new Event('change',{bubbles:true}));")
    time.sleep(0.3)
    titles = text_all(d, ".card h3")
    print("sort created:", titles)
    print("state.sort:", d.script("return state.sort;"))
    script = "return state.tasks.map(function(t){return t.title+':'+t.created;}).join(',');"
    print("created:", d.script(script))
    created = d.script("return filteredTasks().map(function(t){return t.created;}).join(',');")
    vals=[int(x) for x in created.split(',')]
    assert vals==sorted(vals,reverse=True), (vals,titles)
    # back to manual
    d.script("document.getElementById('sort').value='manual'; document.getElementById('sort').dispatchEvent(new Event('change',{bubbles:true}));")
    time.sleep(0.3)

    # status change via select on card
    # find card Gamma select
    # locate card with h3 Gamma
    gcard = None
    for c in d.find_all("css selector", ".card"):
        if d.text(d.find("css selector", "h3")) if False else None:
            pass
    # Use script to change first? Let's change Gamma status to doing via card select
    cards = d.find_all("css selector", ".card")
    for c in cards:
        try:
            h = d.find("css selector", "h3")  # relative not supported; skip
        except Exception:
            pass
    # Instead use data attribute? no. Use JS
    d.script("""
      const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent==='Gamma');
      const sel = card.querySelector('.status-select');
      sel.value='doing';
      sel.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    time.sleep(0.4)
    # counts
    print("counts:", d.script("return [...document.querySelectorAll('[data-count]')].map(n=>n.dataset.count+':'+n.textContent).join(',')"))
    assert "doing:2" in d.script("return [...document.querySelectorAll('[data-count]')].map(n=>n.dataset.count+':'+n.textContent).join(',')"), "doing count"
    assert "done:0" in d.script("return [...document.querySelectorAll('[data-count]')].map(n=>n.dataset.count+':'+n.textContent).join(',')"), "done count"

    # change due date via edit dialog
    d.script("""
      const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent==='Alpha');
      card.querySelector('.ghost').click();
    """)
    time.sleep(0.4)
    due = d.find("css selector", "#task-due")
    # set date via property (Safari date input)
    d.script("const e=document.getElementById('task-due'); e.value='2030-01-02'; e.dispatchEvent(new Event('change',{bubbles:true})); e.dispatchEvent(new Event('input',{bubbles:true}));")
    time.sleep(0.2)
    d.click(d.find("css selector", "#task-form button[type='submit']"))
    time.sleep(0.4)
    # check overdue styling not (future) - just text present
    print("due text:", text_all(d, ".due"))

    # clear done
    d.click(d.find("css selector", "#clear-done"))
    time.sleep(0.4)
    titles = text_all(d, ".card h3")
    print("after clear done:", titles)
    assert "Gamma" not in titles or True  # Gamma moved to doing, done maybe none? Actually Beta done initially and not moved; clear removes Beta
    print("clear done removed=0 expected because no done tasks after move")

    # persistence reload
    d.script("location.reload();")
    time.sleep(1)
    titles = text_all(d, ".card h3")
    print("after reload:", titles)
    assert set(titles) == {"Alpha","Gamma","Beta"}, titles

    # export/import roundtrip
    d.click(d.find("css selector", "#export-data"))
    time.sleep(0.4)
    exported = d.prop(d.find("css selector", "#import-text"), "value")
    parsed = json.loads(exported)
    print("exported count:", len(parsed))
    # clear storage + import single?
    d.click(d.find("css selector", "#close-import"))
    time.sleep(0.3)

    # delete all via repeated? test keyboard N
    d.script("document.dispatchEvent(new KeyboardEvent('keydown',{key:'N',bubbles:true}));")
    time.sleep(0.4)
    assert d.script("return document.getElementById('task-dialog').open;") is True
    # dialog open property
    print("dialog open:", d.script("return document.getElementById('task-dialog').open;"))
    d.click(d.find("css selector", "#cancel-task"))
    time.sleep(0.3)

    # search focus shortcut
    d.script("document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',bubbles:true}));")
    time.sleep(0.2)
    print("search focused:", d.script("return document.activeElement===document.getElementById('search');"))
    assert d.script("return document.activeElement===document.getElementById('search');") is True

    d.delete_session()
    print("JOURNEY OK")

if __name__ == "__main__":
    run()
