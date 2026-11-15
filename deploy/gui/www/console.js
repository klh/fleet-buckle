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
    .row.top {
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .code {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 28px;
      letter-spacing: 0.12em;
      margin: 12px 0;
    }
    button.ghost {
      background: transparent;
      color: var(--dim, #8b949e);
      border: 1px solid var(--line, #2a313c);
    }
    a {
      color: var(--accent, #58a6ff);
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
  // the front door: null = still probing, {name} = signed in
  oidcEnabled = null;
  who = null;
  login = null;
  polling = false;

  async boot() {
    try {
      const cfg = await (await fetch("/api/oidc/config")).json();
      this.oidcEnabled = cfg.enabled === true;
    } catch {
      this.oidcEnabled = false;
    }
    if (this.oidcEnabled) {
      const session = await fetch("/api/oidc/session");
      if (session.ok) this.who = await session.json();
    }
    if (!this.oidcEnabled || this.who !== null) await this.refresh();
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    void this.boot();
  }

  async startLogin() {
    this.err = "";
    const r = await fetch("/api/oidc/login", { method: "POST" });
    if (!r.ok) {
      this.err = await r.text();
      this.requestUpdate();
      return;
    }
    this.login = await r.json();
    this.requestUpdate();
    void this.pollLogin();
  }

  async pollLogin() {
    if (this.login === null || this.polling) return;
    this.polling = true;
    const handle = this.login.handle;
    const wait = (this.login.interval ?? 5) * 1000 + 250;
    try {
      const r = await fetch(`/api/oidc/poll?handle=${encodeURIComponent(handle)}`);
      const out = await r.json();
      if (out.state === "pending" || out.state === "slow_down") {
        if (out.state === "slow_down" && this.login !== null) this.login = { ...this.login, interval: (this.login.interval ?? 5) + 5 };
        setTimeout(() => void this.pollLogin(), out.state === "slow_down" ? wait + 5000 : wait);
      } else if (out.state === "done") {
        this.who = out;
        this.login = null;
        await this.refresh();
      } else {
        this.login = null;
        this.err = out.state === "expired" ? "login expired — start again" : `login failed: ${out.error ?? out.state}`;
        this.requestUpdate();
      }
    } catch (e) {
      this.login = null;
      this.err = String(e);
      this.requestUpdate();
    }
    this.polling = false;
  }

  async logout() {
    await fetch("/api/oidc/logout", { method: "POST" });
    this.who = null;
    this.state = null;
    this.sessions = [];
    this.requestUpdate();
  }

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
    if (this.oidcEnabled === null) return html`<h1>buckle · …</h1>`;
    if (this.oidcEnabled && this.who === null) return this.loginView();
    return this.consoleView();
  }

  loginView() {
    if (this.login === null)
      return html`
        <h1>buckle · sign in</h1>
        <section>
          <h2>the console is behind single sign-on</h2>
          <div class="row">
            <button @click=${() => void this.startLogin()}>sign in with your IdP</button>
          </div>
          <p class="note">device-code flow — your credentials never touch this hub.</p>
        </section>
        ${this.err === "" ? "" : html`<p class="err">${this.err}</p>`}
      `;
    return html`
      <h1>buckle · sign in</h1>
      <section>
        <h2>authorize this browser</h2>
        <p class="code">${this.login.user_code}</p>
        <p>
          open
          <a href=${this.login.verification_uri} target="_blank" rel="noreferrer">${this.login.verification_uri}</a>
          and enter the code — this page waits for approval.
        </p>
        ${this.login.verification_uri_complete === undefined
          ? ""
          : html`<p>
              <a href=${this.login.verification_uri_complete} target="_blank" rel="noreferrer">or approve directly</a>
            </p>`}
      </section>
      ${this.err === "" ? "" : html`<p class="err">${this.err}</p>`}
    `;
  }

  consoleView() {
    const providers = this.state?.providers ?? [];
    const principals = this.state?.principals ?? [];
    const byocUsers = this.sessions.filter((s) => s.principal.startsWith("user:"));
    return html`
      <div class="row top">
        <h1 style="margin:0">buckle · ${this.hubLabel || "…"}</h1>
        ${
          this.who === null
            ? ""
            : html`<span class="note">signed in as ${this.who.name ?? this.who.sub}</span>
                <button class="ghost" @click=${() => void this.logout()}>sign out</button>`
        }
      </div>
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
