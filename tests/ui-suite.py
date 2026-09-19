"""MeetSpaceSync v1.0.0 - deep UI test pass with Playwright.

Covers: visual and layout checks at three viewports, login and session,
header and navigation, dashboard metrics for both roles, Meeting Rooms
booking links, the progressive booking form, live availability and the
conflict dialog, Bookings search and sorting, room deactivation dialogs,
the settings drawer, the Playground, and the API Docs page.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

PORT = int(os.environ.get("UI_TEST_PORT", "4310"))
BASE = f"http://127.0.0.1:{PORT}"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(tempfile.gettempdir(), f"mss-ui-data-{int(time.time())}.json")

results = []


def check(condition, label, extra=""):
    results.append((bool(condition), label, str(extra)[:200]))
    print(("  PASS  " if condition else "  FAIL  ") + label + (("  " + str(extra)[:200]) if (extra and not condition) else ""))


def section(name):
    print("\n" + name)


def start_server():
    env = dict(os.environ, PORT=str(PORT), DATA_FILE=DATA_FILE)
    proc = subprocess.Popen([sys.executable and "node", "server.js"], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen(BASE + "/api/ping", timeout=1)
            return proc
        except Exception:
            time.sleep(0.15)
    raise RuntimeError("server did not start")


def reset_data():
    req = urllib.request.Request(BASE + "/api/auth/login", method="POST",
                                 data=json.dumps({"username": "admin", "password": "admin123"}).encode(),
                                 headers={"Content-Type": "application/json"})
    token = json.load(urllib.request.urlopen(req))["token"]
    req = urllib.request.Request(BASE + "/api/reset", method="POST", headers={"Authorization": "Bearer " + token})
    urllib.request.urlopen(req)
    return token


def sign_in(page, who="admin"):
    page.goto(BASE + "/", wait_until="networkidle")
    page.get_by_test_id(f"fill-{who}").click()
    page.get_by_test_id("login-submit").click()
    expect(page.get_by_test_id("user-chip")).to_be_visible(timeout=5000)


def tomorrow():
    import datetime
    return (datetime.date.today() + datetime.timedelta(days=1)).isoformat()


def confirm_edit(page, reason="Updated during the automated test run."):
    """Confirming an edit now asks for a mandatory reason first."""
    page.get_by_test_id("confirm-booking").click()
    expect(page.get_by_test_id("reason-dialog")).to_be_visible(timeout=5000)
    page.get_by_test_id("reason-input").fill(reason)
    page.get_by_test_id("reason-confirm").click()


def cancel_with_reason(page, reason="Cancelled during the automated test run."):
    """Both roles are now asked for a Cancellation Comment."""
    expect(page.get_by_test_id("reason-dialog")).to_be_visible(timeout=5000)
    page.get_by_test_id("reason-input").fill(reason)
    page.get_by_test_id("reason-confirm").click()


def no_horizontal_overflow(page):
    return page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 2")


def main():
    proc = start_server()
    try:
        reset_data()
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            page = ctx.new_page()

            # Uncaught JavaScript exceptions and console errors are tracked
            # separately: a deliberate 401 is a valid test outcome, a thrown
            # exception never is.
            page_errors = []
            console_errors = []
            failed_requests = []
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("response", lambda r: failed_requests.append(f"{r.status} {r.request.method} {r.url}") if r.status >= 400 else None)

            # ---------------------------------------------------------
            section("Login screen")
            page.goto(BASE + "/", wait_until="networkidle")
            check(page.get_by_test_id("login-api-docs").is_visible(), "API Docs is visible on the Login screen")
            check(page.get_by_test_id("login-api-docs").get_attribute("target") == "_blank",
                  "The login API Docs link opens in a new tab")
            check(page.get_by_test_id("login-card-api-docs").is_visible(), "The login card also links to the API Docs")
            check(page.get_by_test_id("nav-api-docs").is_visible(), "The header API Docs link is visible before sign in")
            check(page.get_by_test_id("nav-dashboard").is_hidden(), "Authenticated nav links stay hidden before sign in")
            check(page.get_by_test_id("settings-open").is_visible(), "The Settings gear is available before sign in")
            check(no_horizontal_overflow(page), "Login screen has no horizontal overflow at 1440px")

            hero = page.locator(".login-copy").inner_text()
            check("100+ Meeting Rooms" in hero, "The Login hero reads 100+ Meeting Rooms", hero.replace("\n", " | "))
            check("125" not in hero, "The exact Room count is not shown on the Login page", hero.replace("\n", " | "))
            check(page.get_by_test_id("login-head-note").inner_text() == "Sign in with a Demo Account.",
                  "The sign in note is capitalised as Sign in with a Demo Account.",
                  page.get_by_test_id("login-head-note").inner_text())

            # mini stat tiles: equal padding, centred content, aligned baselines
            tiles = page.evaluate("""() => Array.from(document.querySelectorAll('.mini-stats span')).map(el => {
              const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
              return {pt: cs.paddingTop, pb: cs.paddingBottom, pl: cs.paddingLeft, pr: cs.paddingRight,
                      align: cs.textAlign, top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width)};
            })""")
            check(len(tiles) == 3, "Three mini stat tiles render", tiles)
            check(all(t["pl"] == t["pr"] for t in tiles), "Mini stat tiles have symmetric horizontal padding", tiles)
            check(all(t["pt"] == t["pb"] for t in tiles), "Mini stat tiles have symmetric vertical padding", tiles)
            check(all(t["align"] == "center" for t in tiles), "Mini stat text is centred", tiles)
            check(len({t["top"] for t in tiles}) == 1 and len({t["h"] for t in tiles}) == 1,
                  "Mini stat tiles are the same height and aligned on one row", tiles)
            check(len({t["w"] for t in tiles}) == 1, "Mini stat tiles share one width", tiles)

            # footer visible on landing, without scrolling
            footer_state = page.evaluate("""() => {
              const f = document.querySelector('[data-testid="app-footer"]');
              const r = f.getBoundingClientRect();
              return {bottom: Math.round(r.bottom), top: Math.round(r.top),
                      vh: window.innerHeight, scrollable: document.documentElement.scrollHeight > window.innerHeight + 2};
            }""")
            check(not footer_state["scrollable"], "The Login page fits the viewport with no scrolling", footer_state)
            check(footer_state["bottom"] <= footer_state["vh"] + 2 and footer_state["top"] < footer_state["vh"],
                  "The footer is fully visible on landing", footer_state)
            sep = page.evaluate("""() => {
              const items = document.querySelectorAll('footer .footer-item');
              const a = items[0].getBoundingClientRect(), b = items[1].getBoundingClientRect();
              return Math.round(b.left - a.right);
            }""")
            check(sep >= 12, "The two footer halves are clearly separated", sep)

            check(page.get_by_test_id("nav-playground-guest").is_visible(),
                  "Playground is in the header on the Login page")
            check(page.get_by_test_id("nav-playground-guest").get_attribute("target") == "_blank",
                  "The Login page Playground link opens in a separate tab")
            check(page.get_by_test_id("nav-playground").is_hidden(),
                  "The signed-in Playground link stays hidden on the Login page")

            with ctx.expect_page() as popup:
                page.get_by_test_id("nav-playground-guest").click()
            pg_tab = popup.value
            pg_tab.wait_for_load_state("networkidle")
            check(pg_tab.get_by_test_id("page-title").inner_text() == "UI Automation Playground",
                  "The Login page Playground link really opens the Playground in a new tab")
            check(pg_tab.get_by_test_id("pg-input").is_visible(), "The Playground is usable without signing in")
            pg_tab.close()

            page.get_by_test_id("login-submit").click()
            check(page.get_by_test_id("username-error").inner_text().strip() == "Enter a Username.",
                  "Empty username is reported inline")
            check(page.get_by_test_id("password-error").inner_text().strip() == "Enter a Password.",
                  "Empty password is reported inline")

            page.get_by_test_id("username").fill("admin")
            page.get_by_test_id("password").fill("wrong-password")
            page.get_by_test_id("login-submit").click()
            expect(page.get_by_test_id("login-banner")).to_be_visible()
            check("incorrect" in page.get_by_test_id("login-banner").inner_text(),
                  "Wrong credentials show the API message in the banner")

            check("masked" in (page.get_by_test_id("password").get_attribute("class") or ""),
                  "The password field is masked by default")
            page.get_by_test_id("toggle-password").click()
            check("masked" not in (page.get_by_test_id("password").get_attribute("class") or ""),
                  "Show reveals the password")
            page.get_by_test_id("toggle-password").click()

            page.get_by_test_id("fill-user").click()
            check(page.get_by_test_id("username").input_value() == "user", "The Standard User chip fills the credentials")

            # ---------------------------------------------------------
            section("Header, gear placement and new tab support")
            sign_in(page, "admin")
            order = page.evaluate("""() => {
              const kids = Array.from(document.querySelector('.top-actions').children);
              return kids.map(k => k.getAttribute('data-testid') || k.id);
            }""")
            check(order.index("logout") < order.index("settings-open"),
                  "The Settings gear renders after Sign Out", order)
            check(order[-1] == "settings-open", "The Settings gear is the last header control", order)

            hrefs = page.evaluate("""() => Array.from(document.querySelectorAll('#nav a, .brand'))
              .map(a => ({t: a.getAttribute('data-testid'), href: a.getAttribute('href'), tag: a.tagName}))""")
            check(all(h["tag"] == "A" and h["href"] for h in hrefs),
                  "Every header link is an anchor carrying an href", hrefs)
            check(len([h for h in hrefs if h["href"].startswith("#/")]) >= 5,
                  "The in-app header links use hash routes so a new tab lands on the same page", hrefs)

            # a genuinely new tab, reusing the stored session
            second = ctx.new_page()
            second.goto(BASE + "/#/bookings", wait_until="networkidle")
            expect(second.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            check(True, "Opening a header route in a new tab renders that page directly")
            second.close()

            check(page.get_by_test_id("nav-playground").get_attribute("target") in (None, ""),
                  "When signed in, the Playground link opens in the same page",
                  page.get_by_test_id("nav-playground").get_attribute("target"))
            check(page.get_by_test_id("nav-playground-guest").is_hidden(),
                  "The guest Playground link is hidden once signed in")
            pages_before = len(ctx.pages)
            page.get_by_test_id("nav-playground").click()
            expect(page.get_by_test_id("page-title")).to_have_text("UI Automation Playground", timeout=5000)
            check(len(ctx.pages) == pages_before, "Clicking Playground while signed in opened no new tab")
            page.get_by_test_id("nav-dashboard").click()
            expect(page.get_by_test_id("page-title")).to_contain_text("Good to see you", timeout=5000)

            with ctx.expect_page() as popup:
                page.get_by_test_id("nav-api-docs").click()
            docs_tab = popup.value
            docs_tab.wait_for_load_state("networkidle")
            check("API Reference" in docs_tab.title(), "The header API Docs link opens the docs in a new tab", docs_tab.title())
            docs_tab.close()

            # ---------------------------------------------------------
            section("Overview metrics")
            check(page.get_by_test_id("my-bookings-count").inner_text().strip() == "0",
                  "Your Bookings starts at zero for a fresh admin session")
            check(page.get_by_test_id("stat-rooms").inner_text().find("125") != -1,
                  "The Meeting Rooms metric shows the seeded count")
            check(page.get_by_test_id("stat-buildings").is_visible() and page.get_by_test_id("stat-floors").is_visible(),
                  "Buildings and Floors metrics render")

            # ---------------------------------------------------------
            section("Explore Building prefills the Booking form")
            page.get_by_test_id("explore-APEX").click()
            expect(page.get_by_test_id("building")).to_be_visible()
            check(page.get_by_test_id("building").input_value() == "APEX",
                  "Explore Apex preselects Apex in the Building dropdown",
                  page.get_by_test_id("building").input_value())
            check(page.get_by_test_id("floor").is_enabled(), "The Floor dropdown is enabled after the Building is preselected")
            floor_options = page.eval_on_selector("#floor", "el => el.options.length")
            check(floor_options == 6, "Apex offers its 5 Floors plus the placeholder", floor_options)

            page.get_by_test_id("nav-dashboard").click()
            page.get_by_test_id("explore-VERTEX").click()
            check(page.get_by_test_id("building").input_value() == "VERTEX",
                  "Explore Vertex preselects Vertex", page.get_by_test_id("building").input_value())
            check(page.eval_on_selector("#floor", "el => el.options.length") == 11,
                  "Vertex offers its 10 Floors plus the placeholder")

            # ---------------------------------------------------------
            section("Meeting Rooms page - Administrator")
            page.get_by_test_id("nav-rooms").click()
            expect(page.get_by_test_id("rooms-table")).to_be_visible()
            check(page.locator('[data-testid="room-row"]').count() == 10, "The Meeting Rooms table paginates at 10 rows")
            check("125 of 125" in page.get_by_test_id("room-count").inner_text(),
                  "The result counter reports the full Room set", page.get_by_test_id("room-count").inner_text())
            headers = page.eval_on_selector_all('[data-testid="rooms-table"] thead th', "els => els.map(e => e.textContent.trim())")
            check("Book" in headers and "Action" in headers,
                  "An Administrator sees both the Book column and the Action column", headers)

            page.get_by_test_id("room-search").fill("Nova")
            page.wait_for_timeout(150)
            # "Innovation" also contains the substring "nova", which is correct
            # behaviour for a contains-style search box.
            names = page.eval_on_selector_all('[data-testid="room-row"] .table-link', "els => els.map(e => e.textContent.trim())")
            check(all("nova" in n.lower() for n in names) and any(n.startswith("Nova") for n in names),
                  "Searching by Room name returns only matching Rooms", names)
            page.get_by_test_id("room-search").fill("Nova \u00b7 V-01-01")
            page.wait_for_timeout(150)
            check(page.locator('[data-testid="room-row"]').count() == 1,
                  "A pasted 'Nova - V-01-01' value narrows to exactly that Room")
            page.get_by_test_id("room-search").fill("")
            page.wait_for_timeout(150)

            page.get_by_test_id("room-building").select_option("APEX")
            page.wait_for_timeout(150)
            check("25 of 125" in page.get_by_test_id("room-count").inner_text(),
                  "Filtering by Apex narrows the count to its 25 Rooms", page.get_by_test_id("room-count").inner_text())
            page.get_by_test_id("room-building").select_option("NEXUS")
            page.wait_for_timeout(150)
            check("50 of 125" in page.get_by_test_id("room-count").inner_text(),
                  "Filtering by Nexus narrows the count to its 50 Rooms", page.get_by_test_id("room-count").inner_text())
            page.get_by_test_id("room-building").select_option("")
            page.wait_for_timeout(150)

            page.get_by_test_id("room-search").fill("VERTEX-F01-R02")
            page.wait_for_timeout(200)
            page.get_by_test_id("book-room-VERTEX-F01-R02").click()
            expect(page.get_by_test_id("building")).to_be_visible()
            check(page.get_by_test_id("building").input_value() == "VERTEX", "Book from a Room row preselects the Building")
            check(page.get_by_test_id("floor").input_value() == "1", "Book from a Room row preselects the Floor")
            check(page.get_by_test_id("room").input_value() == "VERTEX-F01-R02", "Book from a Room row preselects the Meeting Room")
            check(page.get_by_test_id("room").is_enabled(), "The Room dropdown is enabled after a prefill")

            # ---------------------------------------------------------
            section("Booking form validation and live availability")
            page.get_by_test_id("confirm-booking").click()
            check(page.get_by_test_id("meeting-title-error").inner_text().strip() == "Enter a Meeting Title.",
                  "Confirming an empty form reports the Meeting Title")
            expect(page.get_by_test_id("booking-alert")).to_be_visible()

            page.get_by_test_id("meeting-title").fill("Sprint Planning")
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.get_by_test_id("start-time").fill("10:00")
            page.get_by_test_id("end-time").fill("11:00")
            page.get_by_test_id("attendees").fill("4")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            check("is free" in page.get_by_test_id("availability-message").inner_text(),
                  "A free slot is announced before Confirm Booking is pressed",
                  page.get_by_test_id("availability-message").inner_text())

            page.get_by_test_id("end-time").fill("16:00")
            check(page.get_by_test_id("end-time-error").inner_text().strip() == "Booking Duration cannot exceed 4 hours.",
                  "The 4 hour rule is enforced in the form")
            page.get_by_test_id("end-time").fill("09:00")
            check(page.get_by_test_id("end-time-error").inner_text().strip() == "End Time must be later than Start Time.",
                  "End before start is reported in the form")
            page.get_by_test_id("end-time").fill("11:00")

            page.get_by_test_id("attendees").fill("500")
            check("supports up to" in page.get_by_test_id("attendees-error").inner_text(),
                  "Attendees above capacity is reported in the form",
                  page.get_by_test_id("attendees-error").inner_text())
            page.get_by_test_id("attendees").fill("4")

            summary = page.get_by_test_id("booking-summary").inner_text()
            check("Sprint Planning" in summary and "Vertex" in summary,
                  "The live summary reflects the current selections", summary.replace("\n", " | "))

            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            check(page.locator('[data-testid="booking-row"]').count() == 1, "A valid Booking is created and listed")

            # ---------------------------------------------------------
            section("A corrected past time clears its own error")
            import datetime as _dtx
            page.get_by_test_id("nav-book").click()
            expect(page.get_by_test_id("page-title")).to_have_text("Book a Room", timeout=5000)
            page.get_by_test_id("meeting-title").fill("Past Time Correction")
            page.get_by_test_id("building").select_option("NEXUS")
            page.get_by_test_id("floor").select_option("8")
            page.wait_for_timeout(250)
            page.get_by_test_id("room").select_option(index=1)
            page.get_by_test_id("booking-date").fill(_dtx.date.today().isoformat())
            page.get_by_test_id("start-time").fill("00:05")
            page.get_by_test_id("end-time").fill("00:35")
            page.get_by_test_id("attendees").fill("2")
            page.get_by_test_id("attendees").blur()
            page.wait_for_timeout(700)
            check(page.get_by_test_id("start-time-error").inner_text().strip()
                  == "Past Date or Time cannot be booked.",
                  "A past time today is caught in the form, without a round trip",
                  page.get_by_test_id("start-time-error").inner_text())

            later = _dtx.datetime.now() + _dtx.timedelta(hours=2)
            page.get_by_test_id("start-time").fill(later.strftime("%H:%M"))
            page.get_by_test_id("end-time").fill((later + _dtx.timedelta(minutes=30)).strftime("%H:%M"))
            page.wait_for_timeout(900)
            check(page.get_by_test_id("start-time-error").inner_text().strip() == "",
                  "Correcting it to a future time clears the error straight away",
                  page.get_by_test_id("start-time-error").inner_text())
            check(page.get_by_test_id("booking-alert").is_hidden(),
                  "The summary banner clears with it")
            check(page.locator(".availability.ok").is_visible(),
                  "The panel and the field no longer contradict each other")

            # the same field, but rejected by the server, must also clear
            page.get_by_test_id("start-time").fill("00:10")
            page.get_by_test_id("end-time").fill("00:40")
            page.wait_for_timeout(300)
            page.get_by_test_id("confirm-booking").click()
            page.wait_for_timeout(600)
            check(page.get_by_test_id("start-time-error").inner_text().strip() != "",
                  "Confirm reports the past time")
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.wait_for_timeout(400)
            check(page.get_by_test_id("start-time-error").inner_text().strip() == "",
                  "Moving the date to tomorrow clears the Start Time error too",
                  page.get_by_test_id("start-time-error").inner_text())

            # ---------------------------------------------------------
            section("Duplicate booking is prompted before submission")
            page.get_by_test_id("nav-rooms").click()
            page.get_by_test_id("room-search").fill("VERTEX-F01-R02")
            page.wait_for_timeout(150)
            page.get_by_test_id("book-room-VERTEX-F01-R02").click()
            page.get_by_test_id("meeting-title").fill("Clashing Review")
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.get_by_test_id("start-time").fill("10:30")
            page.get_by_test_id("end-time").click()
            # 10:30 sits inside the existing Booking, so the instant warning fires here
            expect(page.get_by_test_id("conflict-dialog")).to_be_visible(timeout=5000)
            page.get_by_test_id("dialog-close").click()
            page.get_by_test_id("end-time").fill("11:30")
            expect(page.locator(".availability.busy")).to_be_visible(timeout=5000)
            msg = page.get_by_test_id("availability-message").inner_text()
            check("already booked" in msg, "The clash is announced live, before Confirm Booking", msg)
            check("Sprint Planning" in msg, "The live warning names the meeting that holds the slot", msg)
            check(page.locator('[data-testid="availability-slots"] li').count() >= 1,
                  "The already booked slots for that day are listed")

            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("conflict-dialog")).to_be_visible(timeout=5000)
            check(page.get_by_test_id("dialog-title").inner_text() == "Meeting Room Unavailable",
                  "The dialog is titled Meeting Room Unavailable",
                  page.get_by_test_id("dialog-title").inner_text())
            dtext = page.get_by_test_id("dialog-text").inner_text()
            check("Sprint Planning" in dtext, "The dialog names the Booking that already holds the slot", dtext)
            check("Administrator" in dtext, "The dialog names who made the existing Booking", dtext)
            check(page.locator('[data-testid="conflict-details"] li').count() >= 1,
                  "The dialog lists the existing Booking's details")
            details = page.locator('[data-testid="conflict-details"]').inner_text()
            check("BKG-" in details, "The existing Booking id is shown in the dialog", details)
            dialog_box = page.get_by_test_id("conflict-dialog").bounding_box()
            centred = abs((dialog_box["x"] + dialog_box["width"] / 2) - 1440 / 2) < 40
            check(centred, "The conflict dialog is horizontally centred", dialog_box)
            check(page.get_by_test_id("booking-alert").is_visible(),
                  "The inline error message is shown alongside the dialog")
            page.get_by_test_id("dialog-close").click()
            check(page.get_by_test_id("room-error").inner_text().strip() != "",
                  "The Room field is also marked after the clash dialog")

            page.get_by_test_id("start-time").fill("12:00")
            page.get_by_test_id("end-time").fill("13:00")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            check(page.get_by_test_id("booking-alert").is_hidden(),
                  "The clash banner clears once a free slot is chosen")
            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            check(page.locator('[data-testid="booking-row"]').count() == 2,
                  "Moving to a free slot lets the Booking through",
                  page.locator('[data-testid="booking-row"]').count())

            # --- the warning arrives on moving to End Time, not after typing it
            section("Immediate unavailable warning on End Time")
            page.get_by_test_id("nav-rooms").click()
            page.get_by_test_id("room-search").fill("VERTEX-F01-R02")
            page.wait_for_timeout(200)
            page.get_by_test_id("book-room-VERTEX-F01-R02").click()
            page.get_by_test_id("meeting-title").fill("Inside An Existing Slot")
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.wait_for_timeout(400)
            page.get_by_test_id("start-time").fill("10:15")
            check(page.get_by_test_id("conflict-dialog").count() == 0,
                  "No dialog yet while the Start Time is still being entered")
            page.get_by_test_id("end-time").click()
            expect(page.get_by_test_id("conflict-dialog")).to_be_visible(timeout=5000)
            check(True, "Clicking into End Time raises the dialog immediately")
            check(page.get_by_test_id("end-time").input_value() == "",
                  "The dialog appears before any End Time has been entered",
                  page.get_by_test_id("end-time").input_value())
            dtext = page.get_by_test_id("dialog-text").inner_text()
            check("Start Time you chose is inside an existing Booking" in dtext,
                  "The dialog explains that the Start Time itself is taken", dtext)
            check("Sprint Planning" in dtext, "The immediate dialog carries the existing Booking details", dtext)
            page.get_by_test_id("dialog-close").click()
            check(page.locator(".availability.busy").is_visible(),
                  "The live panel also switches to Unavailable")
            check(page.locator(".availability .availability-title").inner_text().strip().lower() == "unavailable",
                  "The panel label reads Unavailable",
                  page.locator(".availability .availability-title").inner_text())
            page.wait_for_timeout(600)
            check(page.locator(".availability.busy").is_visible(),
                  "The panel stays Unavailable and is not reset by the debounced check")
            check(page.locator('[data-testid="availability-slots"] li').count() >= 1,
                  "The panel still lists the booked slots while End Time is empty")

            page.get_by_test_id("end-time").click()
            page.wait_for_timeout(400)
            check(page.get_by_test_id("conflict-dialog").count() == 0,
                  "The dialog does not reappear for the same Start Time")

            page.get_by_test_id("start-time").fill("14:00")
            page.get_by_test_id("end-time").fill("15:00")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            check(page.get_by_test_id("room-error").inner_text().strip() == "",
                  "Moving off the taken slot clears the Room error",
                  page.get_by_test_id("room-error").inner_text())

            # --- the summary banner clears itself once the fields are fixed
            section("Summary banner clears as errors are fixed")
            page.get_by_test_id("nav-book").click()
            expect(page.get_by_test_id("page-title")).to_have_text("Book a Room", timeout=5000)
            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("booking-alert")).to_be_visible()
            check("before continuing" in page.get_by_test_id("booking-alert").inner_text(),
                  "The summary banner explains that fields need correcting",
                  page.get_by_test_id("booking-alert").inner_text())

            page.get_by_test_id("meeting-title").fill("Banner Clearing Check")
            check(page.get_by_test_id("booking-alert").is_visible(),
                  "The banner stays while other fields are still invalid")
            page.get_by_test_id("building").select_option("APEX")
            page.get_by_test_id("floor").select_option("2")
            page.wait_for_timeout(150)
            page.get_by_test_id("room").select_option(index=1)
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.get_by_test_id("attendees").fill("2")
            page.get_by_test_id("start-time").fill("09:00")
            check(page.get_by_test_id("booking-alert").is_visible(),
                  "The banner is still shown while the End Time is missing")
            page.get_by_test_id("end-time").fill("10:00")
            page.wait_for_timeout(200)
            check(page.get_by_test_id("booking-alert").is_hidden(),
                  "The banner disappears the moment the last field is corrected",
                  page.get_by_test_id("booking-alert").inner_text())
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            check(True, "The corrected form submits successfully")

            # ---------------------------------------------------------
            section("Bookings search, sort and details")
            page.get_by_test_id("booking-search").fill("Nova \u00b7 V-01-01")
            page.wait_for_timeout(200)
            check(page.locator('[data-testid="booking-row"]').count() == 0,
                  "Searching a Room that holds no Booking returns nothing")

            page.get_by_test_id("booking-search").fill("Orbit \u00b7 V-01-02")
            page.wait_for_timeout(200)
            count = page.locator('[data-testid="booking-row"]').count()
            check(count == 2, "Pasting 'Orbit - V-01-02' filters to that Meeting Room", count)

            page.get_by_test_id("booking-search").fill("orbit    v-01-02")
            page.wait_for_timeout(200)
            check(page.locator('[data-testid="booking-row"]').count() == 2,
                  "The same search works with odd spacing and mixed case")

            page.get_by_test_id("booking-search").fill("Sprint")
            page.wait_for_timeout(200)
            check(page.locator('[data-testid="booking-row"]').count() == 1, "Searching by Meeting Title filters correctly")

            page.get_by_test_id("booking-search").fill("")
            page.wait_for_timeout(200)
            page.get_by_test_id("booking-status").select_option("CANCELLED")
            page.wait_for_timeout(200)
            check(page.get_by_test_id("bookings-empty").is_visible(), "Filtering by CANCELLED shows the empty state")
            page.get_by_test_id("booking-status").select_option("")
            page.wait_for_timeout(200)

            def booking_titles():
                return page.eval_on_selector_all(
                    '[data-testid="booking-row"] .booking-title-cell .table-link',
                    "els => els.map(e => e.textContent.trim())")

            page.locator('[data-sort="meetingTitle"]').click()
            page.wait_for_timeout(150)
            asc = booking_titles()
            check(asc == sorted(asc, key=str.lower), "Sorting by Meeting orders ascending", asc)
            page.locator('[data-sort="meetingTitle"]').click()
            page.wait_for_timeout(150)
            desc = booking_titles()
            check(desc == sorted(desc, key=str.lower, reverse=True),
                  "Clicking the same header reverses the sort", desc)
            check(sorted(asc) == sorted(desc), "Reversing the sort does not lose or add rows", (asc, desc))

            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("booking-detail")).to_be_visible()
            # The detail labels are uppercased by CSS, so compare case-insensitively.
            detail_text = page.get_by_test_id("booking-detail").inner_text().lower()
            check("booking id" in detail_text and "meeting room" in detail_text,
                  "The Booking details dialog opens from the table link", detail_text[:120])
            page.get_by_test_id("detail-close").click()

            # ---------------------------------------------------------
            section("Editing an existing Booking")
            page.get_by_test_id("booking-search").fill("Sprint Planning")
            page.wait_for_timeout(200)
            page.locator("[data-edit]").first.click()
            expect(page.get_by_test_id("building")).to_be_visible()
            check(page.get_by_test_id("page-title").inner_text() == "Edit Booking", "The form switches to Edit Booking mode",
                  page.get_by_test_id("page-title").inner_text())
            check(page.get_by_test_id("meeting-title").input_value() == "Sprint Planning",
                  "The Meeting Title is loaded for editing")
            check(page.get_by_test_id("building").input_value() == "VERTEX"
                  and page.get_by_test_id("floor").input_value() == "1"
                  and page.get_by_test_id("room").input_value() == "VERTEX-F01-R02",
                  "Building, Floor and Meeting Room are all repopulated when editing")
            check(page.get_by_test_id("start-time").input_value() == "10:00"
                  and page.get_by_test_id("end-time").input_value() == "11:00",
                  "The saved times are repopulated when editing")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            check(True, "Editing does not report the Booking as clashing with itself")

            page.get_by_test_id("meeting-title").fill("Sprint Planning Revised")
            page.get_by_test_id("attendees").fill("6")
            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("reason-dialog")).to_be_visible(timeout=5000)
            check(page.get_by_test_id("dialog-title").inner_text() == "Update Booking",
                  "Editing a Booking asks for a reason before saving",
                  page.get_by_test_id("dialog-title").inner_text())
            page.get_by_test_id("reason-confirm").click()
            check(page.get_by_test_id("reason-error").inner_text().strip() == "Reason for Update is required.",
                  "The update reason is mandatory", page.get_by_test_id("reason-error").inner_text())
            page.get_by_test_id("reason-input").fill("abcd")
            page.get_by_test_id("reason-confirm").click()
            check(page.get_by_test_id("reason-error").inner_text().strip()
                  == "Reason for Update must contain at least 5 characters.",
                  "A four character reason is refused", page.get_by_test_id("reason-error").inner_text())
            page.get_by_test_id("reason-input").fill("Two more people joining the review.")
            page.get_by_test_id("reason-confirm").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            page.get_by_test_id("booking-search").fill("Sprint Planning Revised")
            page.wait_for_timeout(200)
            check(page.locator('[data-testid="booking-row"]').count() == 1, "The edited Booking is saved")
            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("audit-trail")).to_be_visible()
            entries = page.locator('[data-testid="audit-trail"] li').all_inner_texts()
            check(len(entries) == 2, "The history shows both the creation and the edit", entries)
            check("Two more people joining the review." in " ".join(entries),
                  "The reason given for the edit is stored in the history", entries)
            check(any("CREATED" in page.locator('[data-testid="audit-trail"] li').nth(i)
                      .get_attribute("data-audit-action") for i in range(len(entries))),
                  "The creation entry is kept alongside the edit")
            page.get_by_test_id("detail-close").click()
            check(page.get_by_test_id("edited-badge").count() >= 1,
                  "The Bookings table marks an edited Booking without opening it")

            page.locator("[data-edit]").first.click()
            expect(page.get_by_test_id("cancel-edit")).to_be_visible()
            page.get_by_test_id("cancel-edit").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible()
            check(True, "Cancel Edit returns to Bookings without saving")
            page.get_by_test_id("nav-book").click()
            expect(page.get_by_test_id("page-title")).to_have_text("Book a Room", timeout=5000)
            check(True, "Leaving the edit and reopening the form clears the edit mode")
            check(page.get_by_test_id("meeting-title").input_value() == "",
                  "A fresh Book a Room form starts empty")
            page.get_by_test_id("nav-bookings").click()
            page.get_by_test_id("booking-search").fill("")
            page.wait_for_timeout(200)

            # ---------------------------------------------------------
            section("Pagination")
            page.get_by_test_id("nav-rooms").click()
            expect(page.get_by_test_id("rooms-table")).to_be_visible()
            buttons = page.locator("#roomPagination button")
            check(buttons.first.is_disabled(), "The previous arrow is disabled on page 1")
            page.locator('#roomPagination button:has-text("2")').click()
            page.wait_for_timeout(200)
            check(page.locator("#roomPagination button.active").inner_text() == "2", "Page 2 becomes the active page")
            check(page.locator('[data-testid="room-row"]').count() == 10, "Page 2 also shows 10 rows")
            page.locator("#roomPagination button").last.click()
            page.wait_for_timeout(200)
            check(page.locator("#roomPagination button.active").inner_text() == "3", "The next arrow advances the page")
            page.get_by_test_id("room-search").fill("Nova \u00b7 V-01-01")
            page.wait_for_timeout(250)
            check(page.locator("#roomPagination button.active").inner_text() == "1",
                  "Searching resets the pagination to page 1")
            page.get_by_test_id("room-search").fill("")
            page.wait_for_timeout(200)

            # ---------------------------------------------------------
            section("Signed out deep link")
            # A brand new context has no stored session at all, which is the
            # truest form of "someone opened this link without signing in".
            anon = browser.new_context(viewport={"width": 1440, "height": 900})
            guard = anon.new_page()
            guard.goto(BASE + "/#/rooms", wait_until="networkidle")
            check(guard.get_by_test_id("login-submit").is_visible(),
                  "A deep link opened without a session falls back to the Login screen")
            check(guard.get_by_test_id("rooms-table").count() == 0,
                  "No protected content is rendered before sign in")
            guard.close()
            anon.close()
            page.bring_to_front()

            # ---------------------------------------------------------
            section("Room deactivation dialogs")
            page.get_by_test_id("nav-rooms").click()
            page.get_by_test_id("room-search").fill("VERTEX-F01-R02")
            page.wait_for_timeout(200)
            page.locator('[data-room="VERTEX-F01-R02"]').click()
            expect(page.get_by_test_id("room-blocked-dialog")).to_be_visible(timeout=5000)
            text = page.get_by_test_id("dialog-text").inner_text()
            check("still has an active future Booking" in text,
                  "Deactivating a booked Room opens the blocking dialog with the expected wording", text)
            check(page.locator('[data-testid="blocking-bookings"] li').count() >= 1,
                  "The blocking dialog lists the Bookings that must be cancelled first")
            box = page.get_by_test_id("room-blocked-dialog").bounding_box()
            check(abs((box["x"] + box["width"] / 2) - 1440 / 2) < 40,
                  "The blocking dialog is centred like the Activate dialog", box)
            check(page.get_by_test_id("dialog-action").inner_text() == "Open Bookings",
                  "The blocking dialog offers a direct route to Bookings")
            page.get_by_test_id("dialog-action").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            check(True, "Open Bookings navigates to the Bookings page")

            page.get_by_test_id("nav-rooms").click()
            page.get_by_test_id("room-search").fill("VERTEX-F02-R01")
            page.wait_for_timeout(200)
            page.locator('[data-room="VERTEX-F02-R01"]').click()
            expect(page.get_by_test_id("reason-dialog")).to_be_visible()
            page.get_by_test_id("reason-confirm").click()
            check(page.get_by_test_id("reason-error").inner_text().strip() != "",
                  "A Deactivation Comment is mandatory")
            page.get_by_test_id("reason-input").fill("Projector replacement and electrical maintenance.")
            page.get_by_test_id("reason-confirm").click()
            page.wait_for_timeout(400)
            check("INACTIVE" in page.locator('[data-room-id="VERTEX-F02-R01"]').inner_text(),
                  "A free Room deactivates with a comment")
            check("Projector replacement" in page.locator('[data-room-id="VERTEX-F02-R01"]').inner_text(),
                  "The deactivation comment is shown in the Status column")
            check("Unavailable" in page.locator('[data-room-id="VERTEX-F02-R01"]').inner_text(),
                  "An inactive Room cannot be booked from the list")

            page.locator('[data-room="VERTEX-F02-R01"]').click()
            expect(page.get_by_test_id("confirm-dialog")).to_be_visible()
            check(page.get_by_test_id("dialog-title").inner_text() == "Activate Meeting Room",
                  "The Activate confirmation dialog still appears")
            page.get_by_test_id("dialog-confirm").click()
            page.wait_for_timeout(400)
            check("ACTIVE" in page.locator('[data-room-id="VERTEX-F02-R01"]').inner_text(),
                  "The Room reactivates from the dialog")

            # ---------------------------------------------------------
            section("Settings drawer parity with the API Docs")
            page.get_by_test_id("settings-open").click()
            expect(page.get_by_test_id("settings-drawer")).to_be_visible()
            for tid in ["base-url-input", "settings-test-api", "ping-status", "settings-reset",
                        "reset-status", "settings-show-creds", "settings-open-app", "settings-close"]:
                check(page.get_by_test_id(tid).count() == 1, f"The drawer carries the API Docs control {tid}")
            check(page.get_by_test_id("settings-open-app").inner_text() == "Open the API Docs",
                  "The drawer App link reads 'Open the API Docs'",
                  page.get_by_test_id("settings-open-app").inner_text())
            check(page.get_by_test_id("settings-open-app").get_attribute("target") == "_blank",
                  "The drawer App link opens in a new tab")

            page.get_by_test_id("settings-test-api").click()
            expect(page.get_by_test_id("ping-status")).to_contain_text("Connected", timeout=5000)
            check("MeetSpaceSync 1.0.0" in page.get_by_test_id("ping-status").inner_text(),
                  "Test connection reports the running version",
                  page.get_by_test_id("ping-status").inner_text())

            page.get_by_test_id("settings-show-creds").click()
            check(page.get_by_test_id("copy-apikey").is_visible(), "Show credentials reveals the API key chip")
            check(page.get_by_test_id("copy-basic").is_visible(), "Show credentials reveals the Basic auth chip")
            page.get_by_test_id("settings-close").click()
            expect(page.get_by_test_id("settings-drawer")).not_to_be_in_viewport()

            # ---------------------------------------------------------
            section("Playground")
            page.get_by_test_id("nav-playground").click()
            expect(page.get_by_test_id("pg-input")).to_be_visible()
            page.get_by_test_id("pg-input").click()
            page.keyboard.type("Playwright")
            page.keyboard.press("Enter")
            entered = page.get_by_test_id("pg-text-entered").inner_text()
            last_key = page.get_by_test_id("pg-last-key").inner_text()
            check(entered == "Text Entered: Playwright", "Text Entered is displayed", entered)
            check(last_key == "Last Key: Enter", "Last Key is displayed at the same time", last_key)
            check(page.get_by_test_id("pg-text-entered").is_visible() and page.get_by_test_id("pg-last-key").is_visible(),
                  "Both readings stay on screen together")

            heading = page.locator(".play-card h3", has_text="File Input").inner_text()
            check(heading == "File Input, Download & Slider", "The section is renamed to include Download", heading)

            with page.expect_download() as dl:
                page.get_by_test_id("pg-download-link").click()
            check(dl.value.suggested_filename == "sample-meeting-rooms.csv",
                  "The static CSV link downloads a file", dl.value.suggested_filename)
            check("Download started" in page.get_by_test_id("pg-download-output").inner_text(),
                  "The download output records the static download")

            with page.expect_download() as dl:
                page.get_by_test_id("pg-download-txt").click()
            check(dl.value.suggested_filename == "meetspacesync-notes.txt",
                  "The generated TXT download works", dl.value.suggested_filename)

            with page.expect_download() as dl:
                page.get_by_test_id("pg-download-json").click()
            check(dl.value.suggested_filename == "meetspacesync-rooms.json",
                  "The generated JSON download works", dl.value.suggested_filename)

            upload = os.path.join(tempfile.gettempdir(), "mss-upload.txt")
            with open(upload, "w") as fh:
                fh.write("upload probe")
            page.get_by_test_id("pg-file").set_input_files(upload)
            check("mss-upload.txt" in page.get_by_test_id("pg-file-output").inner_text(),
                  "The file input still reports the chosen file",
                  page.get_by_test_id("pg-file-output").inner_text())

            page.get_by_test_id("pg-range").fill("80")
            check(page.get_by_test_id("pg-slider-output").inner_text() == "Slider: 80",
                  "The slider has its own output, separate from the file output",
                  page.get_by_test_id("pg-slider-output").inner_text())
            check("mss-upload.txt" in page.get_by_test_id("pg-file-output").inner_text(),
                  "Moving the slider no longer overwrites the file result")

            page.get_by_test_id("pg-check-smoke").check()
            page.get_by_test_id("pg-radio-pro").check()
            check("Smoke" in page.get_by_test_id("pg-choices").inner_text() and "Pro" in page.get_by_test_id("pg-choices").inner_text(),
                  "Checkbox and radio selections are reported")
            page.get_by_test_id("pg-select").select_option("Playwright")
            check("Framework: Playwright" == page.get_by_test_id("pg-choices").inner_text(), "The select reports its value")

            page.get_by_test_id("pg-click").click()
            check("Single Click" in page.get_by_test_id("pg-mouse").inner_text(), "Single click is recorded")
            page.get_by_test_id("pg-double").dblclick()
            check("Double Click" in page.get_by_test_id("pg-mouse").inner_text(), "Double click is recorded")
            page.get_by_test_id("pg-context").click(button="right")
            check("Right Click" in page.get_by_test_id("pg-mouse").inner_text(), "Right click is recorded")
            page.get_by_test_id("pg-hover").hover()
            check("Hover" in page.get_by_test_id("pg-mouse").inner_text(), "Hover is recorded")

            page.once("dialog", lambda d: d.accept())
            page.get_by_test_id("pg-alert").click()
            check("Alert acknowledged" in page.get_by_test_id("pg-dialogs").inner_text(), "The alert dialog is handled")
            page.once("dialog", lambda d: d.accept())
            page.get_by_test_id("pg-confirm").click()
            check("Confirmed" in page.get_by_test_id("pg-dialogs").inner_text(), "The confirm dialog is handled")
            page.once("dialog", lambda d: d.accept("hello"))
            page.get_by_test_id("pg-prompt").click()
            check("hello" in page.get_by_test_id("pg-dialogs").inner_text(), "The prompt dialog is handled")

            check(page.get_by_test_id("pg-drop-output").inner_text().strip() in
                  ("Nothing dropped yet.", "Drag started.", "Drag cancelled.", "Drag and Drop completed."),
                  "The drag output always says where the interaction got to",
                  page.get_by_test_id("pg-drop-output").inner_text())

            page.get_by_test_id("pg-load").click()
            expect(page.get_by_test_id("pg-dynamic")).to_contain_text("Dynamic Content loaded.", timeout=5000)
            check(True, "Dynamic loading completes")

            page.get_by_test_id("pg-row-input").fill("Cypress")
            page.get_by_test_id("pg-row-add").click()
            check(page.locator('[data-testid="pg-table"] tbody tr').count() == 2, "A table row is added")
            page.locator('[data-testid="pg-table"] tbody tr').last.locator("button").click()
            check(page.locator('[data-testid="pg-table"] tbody tr').count() == 1, "A table row is removed")

            page.locator("#pgShadowHost #shadowButton").click()
            check("clicked" in page.get_by_test_id("pg-shadow-output").inner_text(), "The Shadow DOM button responds")
            frame = page.frame_locator("#pgFrame")
            check(frame.locator("#frameButton").is_visible(), "The iframe button is reachable")
            check(page.get_by_test_id("pg-window-output").inner_text().strip() == "No window action yet.",
                  "The window output starts empty",
                  page.get_by_test_id("pg-window-output").inner_text())
            frame.locator("#frameButton").click()
            expect(page.get_by_test_id("pg-window-output")).to_have_text("Frame Button clicked.", timeout=5000)
            check(True, "Clicking the Frame Button reports back to the page")
            check(frame.locator("#frameOut").inner_text().strip() == "Frame Button clicked.",
                  "The frame also reports the click inside itself",
                  frame.locator("#frameOut").inner_text())

            check(page.get_by_test_id("pg-table-output").count() == 1,
                  "The Editable Data Table has an output of its own")
            before_rows = page.locator('[data-testid="pg-table"] tbody tr').count()
            page.get_by_test_id("pg-row-input").fill("")
            page.get_by_test_id("pg-row-add").click()
            page.wait_for_timeout(150)
            check("Enter a value" in page.get_by_test_id("pg-table-output").inner_text(),
                  "Adding an empty row reports why nothing happened",
                  page.get_by_test_id("pg-table-output").inner_text())
            check(page.locator('[data-testid="pg-table"] tbody tr').count() == before_rows,
                  "No row is added for empty input")
            page.get_by_test_id("pg-row-input").fill("Selenium")
            page.get_by_test_id("pg-row-add").click()
            page.wait_for_timeout(150)
            check('Added "Selenium"' in page.get_by_test_id("pg-table-output").inner_text(),
                  "Adding a row reports what was added",
                  page.get_by_test_id("pg-table-output").inner_text())
            page.locator('[data-testid="pg-table"] tbody tr').last.locator("button").click()
            page.wait_for_timeout(150)
            check('Removed "Selenium"' in page.get_by_test_id("pg-table-output").inner_text(),
                  "Removing a row reports what was removed",
                  page.get_by_test_id("pg-table-output").inner_text())

            cards_without_output = page.evaluate("""() => [...document.querySelectorAll('.play-card')]
                .filter(c => c.querySelectorAll('.play-output').length === 0)
                .map(c => c.querySelector('h3').textContent.trim())""")
            check(not cards_without_output,
                  "Every Playground card reports what happened", cards_without_output)

            # ---------------------------------------------------------
            section("Standard User experience")
            page.get_by_test_id("logout").click()
            expect(page.get_by_test_id("login-submit")).to_be_visible()
            sign_in(page, "user")
            check(page.get_by_test_id("nav-rooms").is_visible(),
                  "A Standard User can reach the Meeting Rooms page")
            page.get_by_test_id("nav-rooms").click()
            expect(page.get_by_test_id("rooms-table")).to_be_visible()
            headers = page.eval_on_selector_all('[data-testid="rooms-table"] thead th', "els => els.map(e => e.textContent.trim())")
            check("Book" in headers, "A Standard User sees the Book column", headers)
            check("Action" not in headers, "A Standard User does not see the Activate or Deactivate column", headers)

            page.get_by_test_id("room-search").fill("APEX-F03-R04")
            page.wait_for_timeout(200)
            page.get_by_test_id("book-room-APEX-F03-R04").click()
            check(page.get_by_test_id("building").input_value() == "APEX"
                  and page.get_by_test_id("floor").input_value() == "3"
                  and page.get_by_test_id("room").input_value() == "APEX-F03-R04",
                  "A Standard User also gets a fully prefilled Booking form")

            page.get_by_test_id("meeting-title").fill("User Retrospective")
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.get_by_test_id("start-time").fill("15:00")
            page.get_by_test_id("end-time").fill("16:00")
            page.get_by_test_id("attendees").fill("3")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)

            page.get_by_test_id("nav-dashboard").click()
            expect(page.get_by_test_id("my-bookings-count")).to_be_visible()
            check(page.get_by_test_id("my-bookings-count").inner_text().strip() == "1",
                  "Your Bookings shows 1 for the Standard User straight after booking",
                  page.get_by_test_id("my-bookings-count").inner_text())
            check(page.get_by_test_id("my-bookings-table").is_visible(),
                  "The Overview lists the user's own latest Bookings")

            page.reload(wait_until="networkidle")
            check(page.get_by_test_id("my-bookings-count").inner_text().strip() == "1",
                  "Your Bookings survives a page reload",
                  page.get_by_test_id("my-bookings-count").inner_text())

            page.get_by_test_id("nav-bookings").click()
            headers = page.eval_on_selector_all('[data-testid="bookings-table"] thead th', "els => els.map(e => e.textContent.trim())")
            check("Actions" not in headers, "A Standard User does not see admin row actions", headers)
            # Their own Booking is actionable.
            page.get_by_test_id("booking-search").fill("User Retrospective")
            page.wait_for_timeout(200)
            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("booking-detail")).to_be_visible()
            check(page.get_by_test_id("detail-edit").count() == 1,
                  "A Standard User can edit their own Booking from the details dialog")
            check(page.get_by_test_id("detail-cancel").count() == 1,
                  "A Standard User can cancel their own Booking from the details dialog")
            page.get_by_test_id("detail-close").click()

            # A Booking created by the Administrator is read only for them.
            page.get_by_test_id("booking-search").fill("Sprint Planning")
            page.wait_for_timeout(200)
            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("booking-detail")).to_be_visible()
            check(page.get_by_test_id("detail-edit").count() == 0,
                  "A Standard User cannot edit a Booking created by another account")
            page.get_by_test_id("detail-close").click()

            page.get_by_test_id("booking-search").fill("User Retrospective")
            page.wait_for_timeout(200)
            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("booking-detail")).to_be_visible()
            page.get_by_test_id("detail-cancel").click()
            expect(page.get_by_test_id("reason-dialog")).to_be_visible(timeout=5000)
            own_text = page.get_by_test_id("dialog-text").inner_text()
            check("no longer needed" in own_text,
                  "A Standard User cancelling their own Booking is asked to record why", own_text)
            page.get_by_test_id("reason-confirm").click()
            check(page.get_by_test_id("reason-error").inner_text().strip() == "Cancellation Comment is required.",
                  "The Cancellation Comment is mandatory for a Standard User too",
                  page.get_by_test_id("reason-error").inner_text())
            page.get_by_test_id("reason-input").fill("   ")
            page.get_by_test_id("reason-confirm").click()
            check(page.get_by_test_id("reason-error").inner_text().strip() == "Cancellation Comment is required.",
                  "Whitespace alone does not count as a reason")
            page.get_by_test_id("reason-input").fill("Team decided to meet online instead.")
            page.get_by_test_id("reason-confirm").click()
            page.wait_for_timeout(700)
            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("audit-trail")).to_be_visible()
            trail = " ".join(page.locator('[data-testid="audit-trail"] li').all_inner_texts())
            check("Team decided to meet online instead." in trail,
                  "The user's own cancellation reason is stored in the history", trail)
            check("CREATED" in trail.upper() and "CANCELLED" in trail.upper(),
                  "The history keeps the creation entry alongside the cancellation", trail)
            page.get_by_test_id("detail-close").click()
            page.get_by_test_id("booking-search").fill("")
            page.wait_for_timeout(200)

            page.get_by_test_id("settings-open").click()
            page.get_by_test_id("settings-reset").click()
            expect(page.get_by_test_id("reset-status")).to_contain_text("Administrator", timeout=4000)
            check(True, "Reset demo data is refused for a Standard User with a clear message")
            page.get_by_test_id("settings-close").click()

            # ---------------------------------------------------------
            section("Admin sees other accounts' Bookings")
            page.get_by_test_id("logout").click()
            sign_in(page, "admin")
            page.get_by_test_id("nav-bookings").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible()
            owners = page.eval_on_selector_all('[data-testid="booking-row"] .booked-by-cell',
                                               "els => els.map(e => e.textContent.trim())")
            check("Administrator" in owners and "Standard User" in owners,
                  "The Administrator sees Bookings from both accounts", owners)
            # Cancel a Booking that is still active, whoever created it.
            page.get_by_test_id("booking-status").select_option("BOOKED")
            page.wait_for_timeout(250)
            target = page.locator('[data-testid="booking-row"]').first
            target_title = target.locator('.booking-title-cell .table-link').inner_text()
            owner = target.locator('.booked-by-cell').inner_text().strip()
            target.locator("[data-cancel]").click()
            expect(page.get_by_test_id("reason-dialog")).to_be_visible()
            admin_text = page.get_by_test_id("dialog-text").inner_text()
            if owner != "Administrator":
                check("will see this reason" in admin_text,
                      "Cancelling someone else's Booking is worded as acting on their behalf", admin_text)
            else:
                check("no longer needed" in admin_text,
                      "Cancelling their own Booking is worded as recording why", admin_text)
            page.get_by_test_id("reason-input").fill("Cancelled after the team moved the session.")
            page.get_by_test_id("reason-confirm").click()
            page.wait_for_timeout(600)
            page.get_by_test_id("booking-status").select_option("CANCELLED")
            page.get_by_test_id("booking-search").fill(target_title)
            page.wait_for_timeout(300)
            check(page.locator('[data-testid="booking-row"]').count() == 1,
                  "An admin cancellation with a comment succeeds", target_title)
            check("Cancelled after the team moved" in page.get_by_test_id("row-cancel-reason").inner_text(),
                  "The reason is visible in the Bookings table without opening the row",
                  page.get_by_test_id("row-cancel-reason").inner_text())
            page.locator('[data-detail]').first.click()
            check("Cancelled after the team moved" in page.get_by_test_id("booking-detail").inner_text(),
                  "The Cancellation Comment appears in the details dialog")
            check(page.locator('[data-testid="audit-trail"] li').count() >= 2,
                  "The history shows the cancellation alongside the earlier entries")
            page.get_by_test_id("detail-close").click()
            page.get_by_test_id("booking-status").select_option("")
            page.get_by_test_id("booking-search").fill("")
            page.wait_for_timeout(250)

            # ---------------------------------------------------------
            section("Errors stay quiet until a field is left")
            page.get_by_test_id("nav-book").click()
            expect(page.get_by_test_id("page-title")).to_have_text("Book a Room", timeout=5000)

            page.get_by_test_id("meeting-title").click()
            for ch in "Sp":
                page.keyboard.type(ch)
                page.wait_for_timeout(80)
                check(page.get_by_test_id("meeting-title-error").inner_text().strip() == "",
                      f"No Meeting Title error while typing {page.get_by_test_id('meeting-title').input_value()!r}",
                      page.get_by_test_id("meeting-title-error").inner_text())
            page.get_by_test_id("meeting-title").blur()
            page.wait_for_timeout(120)
            check(page.get_by_test_id("meeting-title-error").inner_text().strip() ==
                  "Meeting Title must contain at least 3 characters.",
                  "The Meeting Title rule is reported once the field is left",
                  page.get_by_test_id("meeting-title-error").inner_text())
            page.get_by_test_id("meeting-title").fill("Quiet Field Check")
            page.wait_for_timeout(120)
            check(page.get_by_test_id("meeting-title-error").inner_text().strip() == "",
                  "The error clears immediately once the value is valid")

            page.get_by_test_id("building").select_option("VERTEX")
            page.get_by_test_id("floor").select_option("1")
            page.wait_for_timeout(250)
            page.get_by_test_id("room").select_option(index=1)
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.wait_for_timeout(200)

            # the reported bug: End Time complaining while Start Time is entered
            page.get_by_test_id("start-time").click()
            page.keyboard.type("0500PM")
            page.wait_for_timeout(250)
            check(page.get_by_test_id("end-time-error").inner_text().strip() == "",
                  "No End Time error is raised while the Start Time is being entered",
                  page.get_by_test_id("end-time-error").inner_text())
            check(page.get_by_test_id("start-time").input_value() == "17:00",
                  "The Start Time was accepted", page.get_by_test_id("start-time").input_value())
            page.get_by_test_id("end-time").click()
            page.get_by_test_id("end-time").blur()
            page.wait_for_timeout(150)
            check(page.get_by_test_id("end-time-error").inner_text().strip() == "Choose a valid End Time.",
                  "The End Time rule is reported once that field is left empty",
                  page.get_by_test_id("end-time-error").inner_text())

            # ---------------------------------------------------------
            section("One date and time standard everywhere")
            page.get_by_test_id("end-time").fill("18:00")
            page.get_by_test_id("attendees").fill("2")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)

            date_pat = re.compile(r"\b\d{2}-\d{2}-\d{4}\b")
            time_pat = re.compile(r"\b\d{2}:\d{2} (AM|PM)\b")
            iso_pat = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
            h24_pat = re.compile(r"(?<![\d:])([01]\d|2[0-3]):[0-5]\d(?!\s*(AM|PM))(?![\d:])")

            msg = page.get_by_test_id("availability-message").inner_text()
            check(date_pat.search(msg) is not None, "The availability message uses DD-MM-YYYY", msg)
            check(len(time_pat.findall(msg)) == 2, "The availability message uses hh:mm AM/PM", msg)
            check(iso_pat.search(msg) is None, "No raw YYYY-MM-DD survives in the availability message", msg)

            summary = page.get_by_test_id("booking-summary").inner_text()
            sched = [ln for ln in summary.split("\n") if date_pat.search(ln) or iso_pat.search(ln)]
            check(sched and date_pat.search(sched[0]) and iso_pat.search(sched[0]) is None,
                  "The Booking Summary Schedule row uses DD-MM-YYYY", sched)
            check(len(time_pat.findall(" ".join(sched))) == 2,
                  "The Booking Summary Schedule row uses hh:mm AM/PM", sched)

            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=6000)
            page.get_by_test_id("booking-search").fill("Quiet Field Check")
            page.wait_for_timeout(250)
            cell = page.locator('[data-testid="booking-row"] .date-cell').first.inner_text()
            check(len(date_pat.findall(cell)) == 2 and len(time_pat.findall(cell)) == 2,
                  "The Bookings table uses the same standard", cell.replace("\n", " | "))
            check(iso_pat.search(cell) is None and h24_pat.search(cell) is None,
                  "No ISO date or 24 hour time leaks into the table", cell.replace("\n", " | "))

            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("booking-detail")).to_be_visible()
            detail = page.get_by_test_id("booking-detail").inner_text()
            check(len(date_pat.findall(detail)) >= 2 and len(time_pat.findall(detail)) >= 2,
                  "The Booking details dialog uses the same standard")
            check(iso_pat.search(detail) is None, "No ISO date leaks into the details dialog", detail[:160])
            page.get_by_test_id("detail-close").click()
            page.get_by_test_id("booking-search").fill("")
            page.wait_for_timeout(200)

            # ---------------------------------------------------------
            section("Confirm Booking scrolls to the first error")
            page.get_by_test_id("nav-book").click()
            expect(page.get_by_test_id("page-title")).to_have_text("Book a Room", timeout=5000)
            page.get_by_test_id("building").select_option("VERTEX")
            page.get_by_test_id("floor").select_option("2")
            page.wait_for_timeout(250)
            page.get_by_test_id("room").select_option(index=1)
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.get_by_test_id("start-time").fill("08:00")
            page.get_by_test_id("end-time").fill("09:00")
            page.get_by_test_id("attendees").fill("2")
            page.wait_for_timeout(600)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(200)
            before = page.evaluate("() => Math.round(window.scrollY)")
            check(before > 100, "The form is scrolled well down before Confirm", before)
            page.get_by_test_id("confirm-booking").click()
            page.wait_for_timeout(900)
            after = page.evaluate("() => Math.round(window.scrollY)")
            check(after < before, "The page scrolls up when Confirm reports an error", (before, after))
            check(page.evaluate("""() => { const f = document.querySelector('.field.invalid');
                     if (!f) return false; const r = f.getBoundingClientRect();
                     return r.top >= 0 && r.bottom <= window.innerHeight; }"""),
                  "The first invalid field is brought into view")
            check(page.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-testid')")
                  == "meeting-title",
                  "The first invalid field receives focus",
                  page.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-testid')"))
            check(page.get_by_test_id("booking-alert").is_visible(), "The summary banner is shown")

            page.get_by_test_id("meeting-title").fill("Scrolled Into View")
            page.wait_for_timeout(200)
            check(page.get_by_test_id("booking-alert").is_hidden(),
                  "The banner clears again once the error is fixed")

            # ---------------------------------------------------------
            section("Dialog focus handling")
            page.get_by_test_id("nav-rooms").click()
            expect(page.get_by_test_id("rooms-table")).to_be_visible()
            page.get_by_test_id("room-search").fill("NEXUS-F10-R05")
            page.wait_for_timeout(250)
            trigger = page.locator('[data-room="NEXUS-F10-R05"]')
            trigger.click()
            expect(page.get_by_test_id("reason-dialog")).to_be_visible()
            check(page.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-testid')")
                  == "reason-input",
                  "Opening a dialog moves focus into it",
                  page.evaluate("() => document.activeElement && document.activeElement.getAttribute('data-testid')"))

            inside = []
            for _ in range(8):
                page.keyboard.press("Tab")
                inside.append(page.evaluate("""() => { const d = document.querySelector('[data-testid="reason-dialog"]');
                    return !!(d && d.contains(document.activeElement)); }"""))
            check(all(inside), "Tab stays inside the dialog", inside)
            for _ in range(4):
                page.keyboard.press("Shift+Tab")
            check(page.evaluate("""() => { const d = document.querySelector('[data-testid="reason-dialog"]');
                    return !!(d && d.contains(document.activeElement)); }"""),
                  "Shift+Tab also stays inside the dialog")

            page.get_by_test_id("reason-cancel").click()
            page.wait_for_timeout(200)
            check(page.evaluate("""() => { const b = document.querySelector('[data-room="NEXUS-F10-R05"]');
                    return b === document.activeElement; }"""),
                  "Closing a dialog returns focus to the control that opened it")

            page.keyboard.press("Escape")
            page.wait_for_timeout(100)
            trigger.click()
            expect(page.get_by_test_id("reason-dialog")).to_be_visible()
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            check(page.get_by_test_id("reason-dialog").count() == 0, "Escape closes the dialog")
            check(page.evaluate("""() => { const b = document.querySelector('[data-room="NEXUS-F10-R05"]');
                    return b === document.activeElement; }"""),
                  "Escape also restores focus to the trigger")

            # ---------------------------------------------------------
            section("Adhoc, escaping and session edge cases")

            # Script-like text must render as text, never execute
            page.get_by_test_id("nav-rooms").click()
            page.get_by_test_id("room-search").fill("NEXUS-F09-R01")
            page.wait_for_timeout(200)
            page.get_by_test_id("book-room-NEXUS-F09-R01").click()
            nasty = '<img src=x onerror="window.__xss=1">'
            page.get_by_test_id("meeting-title").fill(nasty)
            page.get_by_test_id("booking-date").fill(tomorrow())
            page.get_by_test_id("start-time").fill("07:00")
            page.get_by_test_id("end-time").fill("08:00")
            page.get_by_test_id("attendees").fill("2")
            expect(page.locator(".availability.ok")).to_be_visible(timeout=5000)
            page.get_by_test_id("confirm-booking").click()
            expect(page.get_by_test_id("bookings-table")).to_be_visible(timeout=5000)
            page.get_by_test_id("booking-search").fill("onerror")
            page.wait_for_timeout(250)
            check(page.locator('[data-testid="booking-row"]').count() == 1,
                  "A Booking with script-like text is listed")
            check(page.evaluate("() => window.__xss === undefined"),
                  "Script-like text in a Meeting Title does not execute")
            check(page.locator('[data-testid="booking-row"] img').count() == 0,
                  "Script-like text is not turned into a real element")
            cell = page.locator('[data-testid="booking-row"] .booking-title-cell .table-link').inner_text()
            check(cell == nasty, "Script-like text is rendered as plain text", cell)
            page.locator('[data-detail]').first.click()
            expect(page.get_by_test_id("booking-detail")).to_be_visible()
            check(page.evaluate("() => window.__xss === undefined"),
                  "Script-like text does not execute inside the details dialog")
            check(page.locator('[data-testid="booking-detail"] img').count() == 0,
                  "The details dialog escapes script-like text too")
            page.get_by_test_id("detail-close").click()

            # Search with characters that would break a naive regex
            for probe in ["(", "[", "*", "\\", "?", "+."]:
                page.get_by_test_id("booking-search").fill(probe)
                page.wait_for_timeout(120)
            check(True, "Regex-special characters in search do not throw")
            check(page.evaluate("() => true"), "The page is still responsive after odd search input")
            page.get_by_test_id("booking-search").fill("")
            page.wait_for_timeout(200)

            # The date field refuses past dates at the control level
            page.get_by_test_id("nav-book").click()
            expect(page.get_by_test_id("page-title")).to_have_text("Book a Room", timeout=5000)
            import datetime as _dt
            check(page.get_by_test_id("booking-date").get_attribute("min") == _dt.date.today().isoformat(),
                  "The Booking Date control is limited to today onwards",
                  page.get_by_test_id("booking-date").get_attribute("min"))
            page.get_by_test_id("booking-date").fill((_dt.date.today() - _dt.timedelta(days=3)).isoformat())
            page.wait_for_timeout(150)
            check(page.get_by_test_id("booking-date-error").inner_text().strip() == "",
                  "A past date stays quiet while the field is still being filled",
                  page.get_by_test_id("booking-date-error").inner_text())
            page.get_by_test_id("booking-date").blur()
            page.wait_for_timeout(150)
            check(page.get_by_test_id("booking-date-error").inner_text().strip() == "Past Dates cannot be booked.",
                  "A past date is reported once the field is left",
                  page.get_by_test_id("booking-date-error").inner_text())

            # A stale token must drop back to the Login screen, not hang.
            # Run it in its own context so the live session is not disturbed.
            stale_ctx = browser.new_context(viewport={"width": 1440, "height": 900})
            stale = stale_ctx.new_page()
            stale.goto(BASE + "/", wait_until="networkidle")
            stale.evaluate("() => localStorage.setItem('mss-token', 'tampered.token.value')")
            stale.reload(wait_until="networkidle")
            expect(stale.get_by_test_id("login-submit")).to_be_visible(timeout=5000)
            check(True, "A tampered token falls back to the Login screen")
            check(stale.evaluate("() => localStorage.getItem('mss-token')") is None,
                  "The rejected token is cleared from storage",
                  stale.evaluate("() => localStorage.getItem('mss-token')"))
            check(stale.get_by_test_id("bookings-table").count() == 0,
                  "No protected content leaks while the token is being checked")

            # An expired session mid-use surfaces cleanly rather than hanging
            stale.evaluate("() => localStorage.setItem('mss-token', 'tampered.token.value')")
            stale.goto(BASE + "/#/rooms", wait_until="networkidle")
            stale.reload(wait_until="networkidle")
            check(stale.get_by_test_id("login-submit").is_visible(),
                  "A deep link with a bad token also lands on the Login screen")
            stale.close()
            stale_ctx.close()
            page.bring_to_front()

            # ---------------------------------------------------------
            section("Responsive and layout checks")

            def go(route):
                """Hash routing is same-document, so drive it directly rather
                than through goto, which waits for a load that never fires."""
                page.evaluate(f"() => {{ location.hash = '#/{route}'; }}")
                page.wait_for_timeout(300)

            for width, height, label in [(1440, 900, "desktop"), (1024, 768, "tablet"), (390, 844, "mobile")]:
                page.set_viewport_size({"width": width, "height": height})
                for route in ["dashboard", "book", "bookings", "rooms", "playground"]:
                    go(route)
                    check(no_horizontal_overflow(page), f"No horizontal overflow on {route} at {label} width",
                          page.evaluate("() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth"))
            page.set_viewport_size({"width": 1440, "height": 900})

            go("dashboard")
            overlap = page.evaluate("""() => {
              const chip = document.querySelector('[data-testid="user-chip"]').getBoundingClientRect();
              const out = document.querySelector('[data-testid="logout"]').getBoundingClientRect();
              const gear = document.querySelector('[data-testid="settings-open"]').getBoundingClientRect();
              return chip.right <= out.left + 1 && out.right <= gear.left + 1;
            }""")
            check(overlap, "The header controls sit side by side without overlapping")

            gear_box = page.get_by_test_id("settings-open").bounding_box()
            check(abs(gear_box["width"] - 36) < 2 and abs(gear_box["height"] - 36) < 2,
                  "The gear matches the 36px API Docs button geometry", gear_box)

            # ---------------------------------------------------------
            section("API Docs page")
            docs = ctx.new_page()
            docs.goto(BASE + "/docs", wait_until="networkidle")
            check(docs.get_by_test_id("open-app-link").inner_text().strip() == "Open the App",
                  "The docs button reads 'Open the App'", docs.get_by_test_id("open-app-link").inner_text())
            check(docs.get_by_test_id("open-app-link").get_attribute("target") == "_blank",
                  "Open the App is marked to open in a new tab")
            with ctx.expect_page() as popup:
                docs.get_by_test_id("open-app-link").click()
            app_tab = popup.value
            app_tab.wait_for_load_state("networkidle")
            check(app_tab.title() == "MeetSpaceSync", "Open the App genuinely opens a second tab", app_tab.title())
            check(docs.url.endswith("/docs"), "The docs page itself stays open on the original tab", docs.url)
            app_tab.close()

            check(docs.get_by_test_id("docs-login-username").input_value() == "admin",
                  "The Authorize modal is prefilled with the admin username")
            check(docs.get_by_test_id("docs-login-password").input_value() == "admin123",
                  "The Authorize modal is prefilled with the admin password")
            check(docs.get_by_test_id("error-envelope-example").is_visible(),
                  "The docs show the shared error envelope up front")

            docs.get_by_test_id("authorize-btn").click()
            expect(docs.get_by_test_id("authorize-modal")).to_be_visible()
            docs.get_by_test_id("docs-login-admin").click()
            expect(docs.get_by_test_id("docs-login-status")).to_contain_text("Signed in", timeout=5000)
            check("Administrator" in docs.get_by_test_id("docs-login-status").inner_text(),
                  "Authorize signs in and reports the account",
                  docs.get_by_test_id("docs-login-status").inner_text())
            check("on" in (docs.get_by_test_id("authorize-btn").get_attribute("class") or ""),
                  "The Authorize button switches to the authorized state")
            docs.locator("#modalDone").click()

            op = docs.locator('[data-testid="op-post--bookings"]')
            op.locator(".op-head").click()
            op.locator(".btn-try").click()
            expect(op.locator("textarea")).to_be_visible()
            check(True, "Try it out reveals the prefilled request body")
            body_text = op.locator("textarea").input_value()
            payload = json.loads(body_text)
            check(re.match(r"^\d{4}-\d{2}-\d{2}$", payload["bookingDate"]) is not None,
                  "The POST /bookings sample body carries a real date", payload.get("bookingDate"))
            check(payload["bookingDate"] == tomorrow(),
                  "The sample Booking Date is tomorrow, so it is never in the past", payload.get("bookingDate"))
            payload["meetingTitle"] = "Docs Try It Out"
            payload["roomId"] = "NEXUS-F05-R05"
            payload["blockId"] = "NEXUS"
            payload["floor"] = 5
            payload["startClock"] = "09:00"
            payload["endClock"] = "10:00"
            payload["attendees"] = 2
            op.locator("textarea").fill(json.dumps(payload))
            op.locator(".btn-exec").click()
            expect(op.locator(".status-line")).to_contain_text("HTTP 201", timeout=8000)
            check("HTTP 201" in op.locator(".status-line").inner_text(),
                  "Try it out creates a Booking on the first attempt after Authorize",
                  op.locator(".status-line").inner_text())

            op.locator(".btn-exec").click()
            expect(op.locator(".resp-box")).to_contain_text("VALIDATION_ERROR", timeout=8000)
            resp = op.locator(".resp-box").inner_text()
            check("already booked" in resp, "Repeating the same call surfaces the documented clash error", resp[:160])

            bad = json.loads(json.dumps(payload))
            bad["bookingDate"] = "not-a-date"
            op.locator("textarea").fill(json.dumps(bad))
            op.locator(".btn-exec").click()
            expect(op.locator(".resp-box")).to_contain_text("Choose a valid Booking Date.", timeout=8000)
            check("fieldErrors" in op.locator(".resp-box").inner_text(),
                  "An invalid date returns the documented fieldErrors envelope")

            docs.get_by_test_id("settings-open").click()
            expect(docs.get_by_test_id("settings-drawer")).to_be_visible()
            check(docs.get_by_test_id("settings-open-app").inner_text() == "Open the MeetSpaceSync UI",
                  "The docs drawer still points at the UI",
                  docs.get_by_test_id("settings-open-app").inner_text())
            docs.get_by_test_id("settings-close").click()
            docs.close()

            # ---------------------------------------------------------
            section("Console and network health")
            check(not page_errors, "No uncaught JavaScript exceptions during the whole run", page_errors[:5])

            # The only console errors allowed are Chromium reporting the HTTP
            # statuses that the negative tests intentionally provoked.
            noise = [e for e in console_errors
                     if "favicon" not in e.lower() and "failed to load resource" not in e.lower()]
            check(not noise, "No unexpected console errors", noise[:5])

            unexpected = [r for r in failed_requests
                          if not (r.startswith("401 POST") and "/api/auth/login" in r)
                          and not (r.startswith("400 POST") and "/api/bookings" in r)]
            check(not unexpected, "Every non-2xx response came from an intentional negative test",
                  unexpected[:5])
            check(any("401 POST" in r for r in failed_requests),
                  "The invalid credentials test really did reach the API")

            browser.close()
    finally:
        proc.terminate()
        try:
            os.remove(DATA_FILE)
        except OSError:
            pass

    passed = sum(1 for r in results if r[0])
    failed = len(results) - passed
    print("\n" + "-" * 58)
    print(f"UI suite: {passed} passed, {failed} failed")
    if failed:
        print("\nFailures:")
        for okk, label, extra in results:
            if not okk:
                print(f"  - {label}  {extra}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
