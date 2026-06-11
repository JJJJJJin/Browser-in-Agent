# Login & Summarize Dashboard

A reusable playbook: log into a site, open a dashboard, read the key figures, and summarize them.
Replace the placeholders in **bold** with the real target before running.

## Goal
Sign in to **<SITE_URL>** and produce a short summary of the metrics shown on the dashboard.

## Steps
1. `create_browser` with engine `chromium`, then `new_page` at **<SITE_URL>**.
2. `snapshot` the page. Find the username and password fields by their `ref`.
3. `type` the username into the username field, `type` the password into the password field.
4. `click` the **Sign in** button (find its `ref` in the snapshot).
5. If a 2FA / captcha appears that the DOM can't resolve, call `vision_query` to inspect it,
   or report back to the user.
6. `navigate` to the dashboard (or `click` the dashboard link).
7. `snapshot` and read the `- text "…"` lines for the metrics. If a metric is rendered as an
   image/chart, use `vision_query` with a prompt like *"What is the value of the revenue chart?"*.
8. Summarize the figures for the user.

## Notes
- Prefer DOM (`snapshot`) first; only reach for `screenshot` / `vision_query` when the DOM is
  insufficient (charts, images, canvas).
- Never echo the password back to the user.
- Close the browser with `close_browser` when finished.
