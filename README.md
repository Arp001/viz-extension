# Semi-Circular Gauge Chart — Tableau Dashboard Extension

A configurable **speedometer-style semi-circular gauge** extension for Tableau dashboards.  
Built with **D3.js** for rendering and the **Tableau Extensions API** for live data integration, filtering, and interactivity.

![Gauge Preview](https://img.shields.io/badge/Tableau-Extension-blue?style=flat-square)

---

## Features

| Feature | Details |
|---|---|
| **Semi-circular arc gauge** | Speedometer-style with smooth needle animation |
| **Multiple color ranges** | Define unlimited bands (e.g. Red / Yellow / Green) with custom thresholds |
| **Configurable min / max** | Set the gauge scale to any numeric range |
| **Live data binding** | Reads values from any Tableau worksheet measure |
| **Aggregation** | SUM, AVG, MIN, MAX, or First Value |
| **Click-to-filter** | Click a range segment to filter other worksheets in the dashboard |
| **Tooltips** | Hover over the needle or segments for detailed info |
| **Full visual customization** | Needle color, arc thickness, value format, font size, currency symbol, tick marks, labels |
| **Responsive** | Auto-resizes to the extension zone in your dashboard |
| **Persistent settings** | Configuration is saved with the workbook |
| **Percentage mode** | Smart handling of percentage data: auto-detection, 0–1 conversion, % symbol, decimal control, and preset range templates |

---

## Percentage Mode

The extension includes intelligent percentage support for fields that represent rates, ratios, or percentages.

### How It Works

| Mode | Description | Example |
|---|---|---|
| **Off** | Standard number display (default) | 72 → `72` |
| **Auto-Detect** | If min=0 and max≤1, automatically treats data as 0–1 ratios | 0.72 → `72%` |
| **Data is 0–1** | Explicitly treat raw values as ratios; multiplies by 100 for display | 0.85 → `85%` |
| **Data is 0–100** | Data is already in percentage scale; just appends % symbol | 85 → `85%` |

### Configuration

1. Open the config dialog (right-click → Configure).
2. In the **Data** tab, scroll down to **Percentage Mode**.
3. Select the appropriate mode for your data.
4. Choose the number of **decimal places** (0, 1, or 2).
5. Optionally, switch to the **Ranges & Colors** tab and click a **preset button** to apply percentage-appropriate range bands.

### Percentage Range Presets

| Preset | Ranges | Min/Max |
|---|---|---|
| **3-Band (0–100)** | Low (0–33), Medium (33–66), High (66–100) | 0–100 |
| **% 3-Band (0–1)** | Low (0–0.33), Medium (0.33–0.66), High (0.66–1) | 0–1 |
| **% 4-Band (0–1)** | Critical (0–0.25), Low (0.25–0.50), Medium (0.50–0.75), High (0.75–1) | 0–1 |
| **% 3-Band (0–100)** | Low (0–33), Medium (33–66), High (66–100) | 0–100 |

### Examples

#### Example 1: Profit Margin (data stored as 0–1 ratio)

Your Tableau field `Profit Margin` returns values like `0.23`, `0.45`, `0.87`.

- Set **Percentage Mode** → `Data is 0–1`
- Set **Min** = `0`, **Max** = `1`
- Set **Decimal Places** → `1`
- Click the **% 3-Band (0–1)** preset

Result: A value of `0.72` displays as **72.0%** on the gauge.

#### Example 2: Completion Rate (data stored as 0–100)

Your Tableau field `Task Completion %` returns values like `45`, `78`, `92`.

- Set **Percentage Mode** → `Data is 0–100`
- Set **Min** = `0`, **Max** = `100`
- Set **Decimal Places** → `0`

Result: A value of `78` displays as **78%** on the gauge.

#### Example 3: Auto-Detect

If you're unsure, select **Auto-Detect**. The extension will examine the gauge's min/max range:
- If the range is 0–1 → automatically uses 0–1 ratio conversion
- If the range is 0–100 → automatically appends % symbol
- Otherwise → falls back to standard number formatting

---

## Files

```
tableau_gauge_extension/
├── gauge.html                    # Main extension entry point (loaded by Tableau)
├── gauge.js                      # D3 gauge renderer + Tableau API integration
├── config.html                   # Configuration dialog (opened as popup by Tableau)
├── config.js                     # Config dialog logic (initializeDialogAsync / closeDialog)
├── styles.css                    # All styling (gauge + config dialog)
├── index.html                    # Landing page for GitHub Pages root URL
├── gauge_extension.trex          # Manifest pointing to GitHub Pages (brunnerworks-tableau)
├── gauge_extension_local.trex    # Manifest for LOCAL development (localhost:8000)
├── gauge_extension_cloud.trex    # Manifest for PRODUCTION / Tableau Cloud (HTTPS)
├── start_local_server.bat        # Windows — double-click to start the local server
├── start_local_server.sh         # Mac / Linux — run to start the local server
└── README.md                     # This file
```

---

## ⚡ Local Development Setup

> **Important:** Tableau extensions cannot be loaded from `file://` URLs. They must be served over `http://localhost` or `https://`. The steps below start a tiny local web server so Tableau can load the extension.

### Step 1 — Start the Local Web Server

You only need **Python** installed (it comes pre-installed on macOS and most Linux distros; on Windows, install it from [python.org](https://www.python.org/downloads/) — check **"Add Python to PATH"** during install).

#### Windows

Double-click **`start_local_server.bat`**, or open a Command Prompt / PowerShell in the project folder and run:

```bat
python -m http.server 8000
```

#### macOS / Linux

Open a terminal in the project folder and run:

```bash
./start_local_server.sh
```

Or manually:

```bash
python3 -m http.server 8000
```

You should see output like:

```
Serving HTTP on 0.0.0.0 port 8000 ...
```

✅ **Leave this terminal window open** — the server must stay running while you use the extension in Tableau.

You can verify it's working by opening [http://localhost:8000/gauge.html](http://localhost:8000/gauge.html) in your browser — you should see a demo gauge.

### Step 2 — Add the Extension to Tableau Desktop

1. Open your Tableau workbook and go to a **Dashboard** tab.
2. From the **Objects** pane on the left, drag **"Extension"** onto your dashboard.
3. In the dialog that appears, click **"My Extensions"**.
4. Browse to the project folder and select **`gauge_extension_local.trex`**.
5. Tableau will prompt you to allow the extension — click **"Allow"**.
6. The gauge will load (it will show a setup message until you configure it).

### Step 3 — Configure the Gauge

1. **Right-click** the extension zone on the dashboard → select **"Configure"**.
2. In the configuration dialog:
   - **Data tab** — Pick your worksheet, the measure field, aggregation method, and min/max values.
   - **Ranges & Colors tab** — Add or edit colored bands (e.g. red 0–40, yellow 40–70, green 70–100).
   - **Visual tab** — Customize needle color, arc thickness, value format, fonts, and labels.
   - **Interaction tab** — Toggle click-to-filter, tooltips, and needle animation.
3. Click **"Save & Apply"** — the gauge will render with your live data.

### Stopping the Server

Press **Ctrl+C** in the terminal / command prompt where the server is running.

---

## Switching to Cloud / Production (Tableau Cloud / Server)

When you're ready to publish your workbook to Tableau Cloud or Tableau Server, you need to host the extension files on an **HTTPS** URL that Tableau can reach.

### Step 1 — Host the Files

Upload `gauge.html`, `gauge.js`, and `styles.css` to any HTTPS static host:

| Host | How |
|---|---|
| **GitHub Pages** | Push to a repo → Settings → Pages → enable. URL: `https://<user>.github.io/<repo>/gauge.html` |
| **Netlify** | Drag-and-drop the folder at [app.netlify.com](https://app.netlify.com). Instant HTTPS. |
| **Vercel** | Similar to Netlify — one-click deploy. |
| **AWS S3 + CloudFront** | Upload to S3, serve via CloudFront with SSL. |
| **Azure Blob + CDN** | Upload to Azure Blob, front with Azure CDN. |

### Step 2 — Update the Cloud .trex File

Open **`gauge_extension_cloud.trex`** and replace the placeholder URL with your actual hosted URL:

```xml
<source-location>
  <url>https://your-actual-domain.com/gauge.html</url>
</source-location>
```

### Step 3 — Allow-List in Tableau Cloud

1. Go to your Tableau Cloud site → **Settings → Extensions**.
2. Under **"Enable Specific Extensions"**, add the base URL of your hosted extension (e.g. `https://your-actual-domain.com`).
3. Set **Full Data Access** to **Allowed**.

### Step 4 — Add to Dashboard

1. In Tableau Cloud (web editing mode), drag an **Extension** zone onto your dashboard.
2. Click **"My Extensions"** → upload **`gauge_extension_cloud.trex`**.
3. Configure the gauge as described above.

---

## Which .trex File Should I Use?

| Scenario | File to Use |
|---|---|
| **Developing / testing locally** with Tableau Desktop | `gauge_extension_local.trex` |
| **Publishing** to Tableau Cloud or Tableau Server | `gauge_extension_cloud.trex` (after editing the URL) |

> **Tip:** The `.trex` file simply tells Tableau *where* to load the extension HTML from. The local version points to `http://localhost:8000`, while the cloud version points to your HTTPS host. The extension code itself is identical.

---

## Configuration Guide

### Data Tab

| Setting | Description |
|---|---|
| **Worksheet** | The Tableau worksheet supplying data to the gauge |
| **Measure** | The numeric field whose value drives the needle |
| **Aggregation** | How multiple rows are combined: SUM, AVG, MIN, MAX, FIRST |
| **Min / Max Value** | The numeric scale endpoints of the gauge |
| **Title / Subtitle** | Displayed above the gauge |

### Ranges & Colors Tab

Add as many color bands as needed. Each range has:

| Property | Description |
|---|---|
| **Color** | The fill color for that arc segment |
| **From** | Start value of the range |
| **To** | End value of the range |
| **Label** | Descriptive name (shown in tooltips and optionally on the arc) |

**Example ranges for a KPI gauge (0–100):**

| From | To | Color | Label |
|---|---|---|---|
| 0 | 40 | `#dc3545` (red) | Below Target |
| 40 | 70 | `#ffc107` (yellow) | Approaching |
| 70 | 100 | `#28a745` (green) | On Target |

### Visual Tab

| Setting | Description |
|---|---|
| **Needle Color** | Color of the pointer needle |
| **Track Color** | Background arc color behind the range bands |
| **Value Font Size** | Size of the center value text (10–80 px) |
| **Value Color** | Color of the center value text |
| **Arc Thickness** | Width of the arc as a percentage of the radius (10–60%) |
| **Value Format** | Number, Decimal (1 or 2), Percent, Currency, or Compact |
| **Currency Symbol** | Symbol prepended when Currency format is selected |
| **Show Min/Max Labels** | Display the scale endpoints at the arc edges |
| **Show Tick Marks** | Display graduation marks around the arc |
| **Show Range Labels** | Display range labels directly on the colored arc segments |

### Interaction Tab

| Setting | Description |
|---|---|
| **Click-to-filter** | When enabled, clicking a colored range segment applies a range filter on other worksheets in the dashboard |
| **Filter Field** | The field used for filtering (defaults to the measure) |
| **Show Tooltips** | Display value/range info on hover |
| **Animate Needle** | Elastic animation when the gauge loads or updates |

---

## Troubleshooting

| Issue | Solution |
|---|---|
| **"Configure" button does nothing** | See the detailed section below |
| **"Extension not configured"** | Right-click the extension → Configure → select worksheet and measure |
| **Gauge shows 0 or wrong value** | Verify the correct measure is selected and the worksheet has data |
| **"Refused to connect" or blank screen** | Make sure the local server is running (`start_local_server.bat` or `.sh`) |
| **`file://` URL error** | You cannot open the `.trex` file directly — you must use the local server as described above |
| **Extension won't load in Tableau Cloud** | Ensure the URL in `gauge_extension_cloud.trex` is HTTPS and allow-listed in site settings |
| **Click-to-filter doesn't work** | The filter field must exist on the target worksheets |
| **Python not found** | Install Python from [python.org](https://www.python.org/downloads/) and check "Add Python to PATH" |
| **404 on GitHub Pages root** | The landing page is at the root URL; the extension itself is at `/gauge.html` |
| **Config popup blocked** | If Tableau shows a popup-blocked warning, allow popups for the extension's domain |

### "Configure" Button Not Working

If clicking **Configure** in the context menu does nothing, here are the most common causes and fixes:

1. **Architecture requirement**: The Tableau Extensions API requires the config dialog to be a **separate HTML page** opened via `displayDialogAsync()`. An inline `<div>` overlay inside the main page will **not** work — Tableau's iframe sandbox blocks it. This extension uses the correct popup pattern (`config.html` opened as a popup).

2. **Same-origin requirement**: The `config.html` URL must be on the **same domain** as `gauge.html`. If you moved files or changed hosting, make sure both files are at the same base URL.

3. **Check the browser console**: In Tableau Desktop, open the developer console:
   - **Windows**: While Tableau is focused, hold `Ctrl+Shift` and press the `D` key. This opens a debugging window. Look for `[Gauge]` and `[Config]` log messages.
   - **Mac**: Not natively available — test via the browser at your extension URL instead.

4. **Popup blocker**: Some browsers or security software block popup windows. If using Tableau Server/Cloud, ensure popups are allowed for the extension's domain.

5. **Reload the extension**: Right-click the extension zone → **Reload** to force Tableau to re-initialize the extension with the latest code.

6. **Verify the `.trex` URL matches**: Open the `.trex` file and confirm the `<url>` points to the correct, accessible `gauge.html` URL. Navigate to that URL in a browser — you should see the demo gauge.

---

## Development & Testing Outside Tableau

The extension includes a **demo mode** that activates automatically when the Tableau Extensions API is not available (i.e., when opened in a regular browser). This renders a sample gauge showcasing **percentage mode** — a raw value of `0.72` displayed as `72.0%` with 0–1 range bands — making it easy to test styling, layout, and percentage formatting.

```bash
# Start local server
python3 -m http.server 8000

# Open in browser
open http://localhost:8000/gauge.html
```

---

## Technology Stack

- **[Tableau Extensions API v1.12](https://tableau.github.io/extensions-api/)** — Dashboard data access, filtering, and settings persistence
- **[D3.js v7](https://d3js.org/)** — SVG-based gauge rendering with arcs, transitions, and scales
- **Vanilla CSS** — No framework dependencies, lightweight and fast

---

## License

MIT — free to use, modify, and distribute.
