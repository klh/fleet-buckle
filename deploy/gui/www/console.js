// console.js — the azure hub console: ONE Lit component wrapping
// native elements (UI law: Lit + tokens, never innerHTML). Panes:
// health, hubs (providers — the over-layer writer), keys (mint, once,
// for settings-declared principals), and the live BYOC sessions from
// /v1/stats (the user:<sha8> rows — attribution with zero identity).
import { LitElement, css, html } from "./vendor/lit.js";

class BuckleConsole extends LitElement {
  static styles = css`
    :host {
      display: block;
      max-width: 980px;
      margin: 0 auto;
      padding: 24px 16px 64px;
      color: var(--ink, #e6edf3);
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
    }
    h1 {
      font-size: 18px;
      margin: 0 0 4px;
    }
    h2 {
      font-size: 13px;
      margin: 0 0 10px;
      color: var(--dim, #8b949e);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    section {
      background: var(--panel, #161b22);
      border: 1px solid var(--line, #2a313c);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 13px;
    }
    th {
      text-align: left;
      color: var(--dim, #8b949e);
      font-weight: 500;
      padding: 4px 10px 8px 0;
    }
    td {
      padding: 5px 10px 5px 0;
      border-top: 1px solid var(--line, #2a313c);
    }
    input,
    select,
    button {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 13px;
    }
    input,
    select {
      background: var(--bg, #0e1116);
      color: inherit;
      border: 1px solid var(--line, #2a313c);
      border-radius: 6px;
      padding: 6px 8px;
    }
    button {
      background: var(--accent, #58a6ff);
      color: #04121f;
      border: 0;
      border-radius: 6px;
      padding: 6px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button[disabled] {
      opacity: 0.5;
      cursor: default;
    }
    .byoc {
      color: var(--warn, #d29922);
    }
    .dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--dim, #8b949e);
      margin-right: 6px;
    }
    .dot.up {
      background: var(--ok, #3fb950);
    }
    .dot.down {
      background: var(--bad, #f85149);
    }
    .minted {
      color: var(--ok, #3fb950);
      word-break: break-all;
    }
    .note {
      color: var(--dim, #8b949e);
      font-size: 12px;
      margin: 8px 0 0;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .err {
      color: var(--bad, #f85149);
      font-size: 13px;
      margin: 8px 0 0;
    }
  `;

  state = null;
  sessions = [];
  up = null;
  hubLabel = "";
  err = "";
  mintedKey = "";
  mintPrincipal = "";
  addLabel = "";
  addUrl = "";

  async refresh() {
    try {
      const state = await (await fetch("/api/state")).json();
      this.state = state;
      this.hubLabel = state.hub;
      const health = await fetch("/api/health");
      this.up = health.ok;
      const stats = await (await fetch("/api/stats")).json();
      this.sessions = stats.self?.principals ?? [];
      this.err = "";
    } catch (e) {
      this.err = String(e);
    }
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  async mint() {
    this.mintedKey = "";
    const r = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ principal: this.mintPrincipal }),
    });
    if (r.ok) {
      const out = await r.json();
      this.mintedKey = out.key; // shown ONCE
    } else {
      this.err = await r.text();
    }
    await this.refresh();
  }

  async addHub() {
    const r = await fetch("/api/hubs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: this.addLabel === "" ? {} : { [this.addLabel]: { url: this.addUrl } },
      }),
    });
    if (!r.ok) this.err = await r.text();
    this.addLabel = "";
    this.addUrl = "";
    await this.refresh();
  }

  render() {
    const providers = this.state?.providers ?? [];
    const principals = this.state?.principals ?? [];
    const byocUsers = this.sessions.filter((s) => s.principal.startsWith("user:"));
    return html`
      <h1>buckle · ${this.hubLabel || "…"}</h1>
      <section>
        <h2>health</h2>
        <p>
          <span class="dot ${this.up === null ? "" : this.up ? "up" : "down"}"></span>
          ${this.up === null ? "probing…" : this.up ? "up" : "down"}
        </p>
      </section>
      <section>
        <h2>hubs (providers)</h2>
        <table>
          <thead>
            <tr>
              <th>label</th>
              <th>url</th>
              <th>dialect</th>
              <th>credential</th>
            </tr>
          </thead>
          <tbody>
            ${providers.map(
              (p) => html`
                <tr>
                  <td>${p.label}</td>
                  <td>${p.url}</td>
                  <td>${p.dialect}</td>
                  <td class=${p.user_token ? "byoc" : ""}>
                    ${p.user_token ? "BYOC — the user's /w/ token" : "unit key file"}
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
        <div class="row" style="margin-top:12px">
          <input
            placeholder="label (e.g. mscopilot)"
            .value=${this.addLabel}
            @input=${(e) => (this.addLabel = e.target.value)}
          />
          <input
            placeholder="https://provider/api"
            .value=${this.addUrl}
            @input=${(e) => (this.addUrl = e.target.value)}
          />
          <button @click=${() => void this.addHub()} ?disabled=${this.addLabel === ""}>
            add provider
          </button>
        </div>
        <p class="note">
          BYOC seats need no key here — each developer's own token rides their requests
          (<code>/w/&lt;lane&gt;/&lt;token&gt;/…</code>).
        </p>
      </section>
      <section>
        <h2>keys (settings-declared principals)</h2>
        <div class="row">
          <select @change=${(e) => (this.mintPrincipal = e.target.value)}>
            <option value="">choose principal…</option>
            ${principals.map((p) => html`<option value=${p.id}>${p.id}</option>`)}
          </select>
          <button @click=${() => void this.mint()} ?disabled=${this.mintPrincipal === ""}>
            mint key
          </button>
        </div>
        ${
          this.mintedKey === ""
            ? ""
            : html`<p class="minted">${this.mintedKey}</p>
                <p class="note">shown once — store it now (0600 file on the hub).</p>`
        }
      </section>
      <section>
        <h2>live BYOC sessions (pseudonymous)</h2>
        <table>
          <thead>
            <tr>
              <th>principal</th>
              <th>requests</th>
              <th>tokens</th>
            </tr>
          </thead>
          <tbody>
            ${byocUsers.map(
              (s) => html`
                <tr>
                  <td>${s.principal}</td>
                  <td>${s.requests}</td>
                  <td>${s.tokens}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
        ${
          byocUsers.length === 0
            ? html`<p class="note">
                no user sessions yet — devs ride /w/&lt;lane&gt;/&lt;token&gt;/…
              </p>`
            : ""
        }
      </section>
      ${this.err === "" ? "" : html`<p class="err">${this.err}</p>`}
    `;
  }
}

customElements.define("buckle-console", BuckleConsole);
