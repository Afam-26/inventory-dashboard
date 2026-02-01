// src/pages/Landing.jsx
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { getStoredUser, getTenantId } from "../services/api";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:5000") + "/api";

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  // ✅ Contact form state (+ honeypot: website)
  const [contact, setContact] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
    website: "", // honeypot (should stay empty)
  });

  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState("");
  const [contactOk, setContactOk] = useState(false);

  // ✅ SAFE: read storage fresh each render
  const user = getStoredUser();
  const tenantId = getTenantId();
  const token = localStorage.getItem("token") || "";

  // ✅ “logged in” must mean token + user
  const isAuthed = Boolean(token) && Boolean(user);
  const needsLogin = !isAuthed;
  const needsTenant = isAuthed && !tenantId;

  // ✅ Auto-redirect only when truly authenticated
  if (!needsLogin) {
    return needsTenant ? <Navigate to="/select-tenant" replace /> : <Navigate to="/dashboard" replace />;
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function setContactField(key, value) {
    setContact((p) => ({ ...p, [key]: value }));
  }

  async function submitRequestAccess(e) {
    e.preventDefault();
    setContactError("");
    setContactOk(false);

    const name = String(contact.name || "").trim();
    const email = String(contact.email || "").trim();
    const company = String(contact.company || "").trim();
    const message = String(contact.message || "").trim();
    const website = String(contact.website || "").trim(); // honeypot

    if (!name) return setContactError("Full name is required.");
    if (!email) return setContactError("Email is required.");
    if (!email.includes("@")) return setContactError("Enter a valid email.");

    setContactLoading(true);

    try {
      const res = await fetch(`${API_BASE}/public/request-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ name, email, company, message, website }),
      });

      const data = await safeJson(res);

      if (!res.ok) {
        throw new Error(data?.message || "Request failed. Please try again.");
      }

      setContactOk(true);
      setContact({
        name: "",
        email: "",
        company: "",
        message: "",
        website: "",
      });
    } catch (err) {
      const msg = err?.message || "Unable to send request.";
      setContactError(msg);

      // optional fallback mailto (only if you still want it)
      const mailto = `mailto:admin@store.com?subject=${encodeURIComponent("Request access")}&body=${encodeURIComponent(
        `Name: ${name}\nEmail: ${email}\nCompany: ${company}\n\nMessage:\n${message}`
      )}`;

      try {
        window.open(mailto, "_blank");
      } catch {
        // ignore
      }
    } finally {
      setContactLoading(false);
    }
  }

  return (
    <>
      {/* Top bar */}
      <header className="lp-topbar">
        <div className="lp-topbar-inner">
          <div className="lp-topbar-left">
            <span className="lp-muted">Built for multi-tenant inventory</span>
            <span className="lp-rolePill">OWNER</span>
          </div>

          <nav className="lp-topbar-nav">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#contact">Contact</a>
          </nav>

          <div className="lp-topbar-actions">
            <a className="btn" href="#pricing">
              See pricing
            </a>
            <Link className="btn" to="/login">
              Sign in
            </Link>
            <Link className="btn" to="/signup">
              Create account
            </Link>
          </div>

          <button
            className="btn lp-btn-outline lp-mobileMenuBtn"
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen((s) => !s)}
          >
            ☰
          </button>
        </div>

        {/* Mobile menu */}
        <div className={`lp-mobileMenu ${menuOpen ? "" : "lp-hidden"}`}>
          <a href="#features" onClick={closeMenu}>
            Features
          </a>
          <a href="#how" onClick={closeMenu}>
            How it works
          </a>
          <a href="#pricing" onClick={closeMenu}>
            Pricing
          </a>
          <a href="#contact" onClick={closeMenu}>
            Contact
          </a>

          <div className="lp-mobileMenuActions">
            <a className="btn" href="#pricing" onClick={closeMenu}>
              See pricing
            </a>
            <Link className="btn" to="/login" onClick={closeMenu}>
              Sign in
            </Link>
            <Link className="btn" to="/signup" onClick={closeMenu}>
              Create account
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-heroWrap">
        <div className="lp-container">
          <div className="lp-heroGrid">
            <aside className="lp-sidebarPreview">
              <div className="lp-sidebarTitle">Inventory</div>

              <div className="lp-sidebarLinks">
                <div className="lp-sidebarLink lp-active">Dashboard</div>
                <div className="lp-sidebarLink">Products</div>
                <div className="lp-sidebarLink">Categories</div>
                <div className="lp-sidebarLink">Stock In / Out</div>
                <div className="lp-sidebarLink">Users</div>
                <div className="lp-sidebarLink">Audit Dashboard</div>
                <div className="lp-sidebarLink">Billing</div>
                <div className="lp-sidebarLink">Audit Logs</div>
              </div>

              <div className="lp-sidebarNote">
                <div className="lp-sidebarNoteTitle">Painless control</div>
                <div className="lp-sidebarNoteText">Multi-tenant • roles • audit trails — built in.</div>
              </div>
            </aside>

            <div className="lp-heroRight">
              <h1 className="lp-heroTitle">One dashboard. Total control.</h1>
              <p className="lp-heroSub">
                Track products, stock, users, and multiple tenants in one clean system. No spreadsheets. No confusion.
              </p>

              <div className="lp-heroActions">
                <a className="btn" href="#contact">
                  Start free
                </a>
                <a className="btn lp-btn-outline" href="#features">
                  See features
                </a>
              </div>

              <div className="lp-kpiGrid">
                <div className="card">
                  <div className="lp-cardTitle">Total Products</div>
                  <div className="lp-cardValue">0</div>
                </div>

                <div className="card">
                  <div className="lp-cardTitle">Low Stock Items</div>
                  <div className="lp-cardValue">0</div>
                </div>

                <div className="card">
                  <div className="lp-cardTitle">Inventory Value</div>
                  <div className="lp-cardValue">$0.00</div>
                </div>
              </div>

              <div className="lp-trustRow">
                <span className="lp-trustPill">Fast setup</span>
                <span className="lp-trustPill">Role-based access</span>
                <span className="lp-trustPill">Tenant isolation</span>
                <span className="lp-trustPill">Audit logs</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="lp-section">
        <div className="lp-container">
          <h2 className="lp-sectionTitle">Everything you need. Nothing you don’t.</h2>
          <p className="lp-sectionSub">Clean UI. Clear control. Built like a real dashboard.</p>

          <div className="lp-cardsGrid">
            <div className="card">
              <div className="lp-featureTitle">Products + Inventory</div>
              <p className="lp-featureText">Track stock, categories, barcodes, and pricing—accurately.</p>
            </div>
            <div className="card">
              <div className="lp-featureTitle">Multi-tenant by default</div>
              <p className="lp-featureText">Run multiple stores/companies with clean separation.</p>
            </div>
            <div className="card">
              <div className="lp-featureTitle">Roles + Permissions</div>
              <p className="lp-featureText">Owner/admin/staff controls with role badges.</p>
            </div>
            <div className="card">
              <div className="lp-featureTitle">Audit-ready activity</div>
              <p className="lp-featureText">Know who changed what, when—automatically.</p>
            </div>
            <div className="card">
              <div className="lp-featureTitle">Dashboard stats</div>
              <p className="lp-featureText">Simple KPI cards and trends that actually help.</p>
            </div>
            <div className="card">
              <div className="lp-featureTitle">Brand per tenant</div>
              <p className="lp-featureText">Tenant-specific branding to look professional.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How */}
      <section id="how" className="lp-section lp-sectionTightTop">
        <div className="lp-container">
          <div className="card lp-cardWide">
            <h2 className="lp-sectionTitle lp-noMargin">Setup in minutes.</h2>
            <p className="lp-sectionSub lp-subTight">Three steps and you’re running cleaner operations.</p>

            <div className="lp-howGrid">
              <div className="lp-howItem">
                <div className="lp-howNum">1</div>
                <div>
                  <div className="lp-howTitle">Create a tenant</div>
                  <div className="lp-howText">One space per store/company.</div>
                </div>
              </div>
              <div className="lp-howItem">
                <div className="lp-howNum">2</div>
                <div>
                  <div className="lp-howTitle">Add products + users</div>
                  <div className="lp-howText">Assign roles and permissions.</div>
                </div>
              </div>
              <div className="lp-howItem">
                <div className="lp-howNum">3</div>
                <div>
                  <div className="lp-howTitle">Track + grow</div>
                  <div className="lp-howText">Stock, KPIs, logs, and reports.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="lp-section">
        <div className="lp-container">
          <h2 className="lp-sectionTitle">Pricing that scales with you.</h2>
          <p className="lp-sectionSub">Start free. Upgrade when you need more tenants and controls.</p>

          <div className="lp-priceGrid">
            <div className="card lp-priceCard">
              <div className="lp-priceTop">
                <div className="lp-priceName">Starter</div>
                <div className="lp-priceTag">Solo</div>
              </div>
              <div className="lp-priceValue">$0</div>
              <div className="lp-priceSmall">Free forever</div>
              <ul className="lp-priceList">
                <li>1 tenant</li>
                <li>Up to 200 products</li>
                <li>Basic roles</li>
                <li>Email support</li>
              </ul>
              <a className="btn lp-btn-outline lp-full" href="#contact">
                Start free
              </a>
            </div>

            <div className="card lp-priceCard lp-featured">
              <div className="lp-priceTop">
                <div className="lp-priceName">Pro</div>
                <div className="lp-priceTag lp-primary">Most popular</div>
              </div>
              <div className="lp-priceValue">$29</div>
              <div className="lp-priceSmall">per month</div>
              <ul className="lp-priceList">
                <li>Up to 10 tenants</li>
                <li>Unlimited products</li>
                <li>Role badges + permissions</li>
                <li>Audit logs + alerts</li>
                <li>Priority support</li>
              </ul>
              <a className="btn lp-full" href="#contact">
                Choose Pro
              </a>
            </div>

            <div className="card lp-priceCard">
              <div className="lp-priceTop">
                <div className="lp-priceName">Business</div>
                <div className="lp-priceTag">Teams</div>
              </div>
              <div className="lp-priceValue">$79</div>
              <div className="lp-priceSmall">per month</div>
              <ul className="lp-priceList">
                <li>Unlimited tenants</li>
                <li>Advanced analytics</li>
                <li>Custom branding</li>
                <li>SLA support</li>
              </ul>
              <a className="btn lp-btn-outline lp-full" href="#contact">
                Talk to sales
              </a>
            </div>
          </div>

          <p className="lp-muted lp-note">*Pricing is placeholder — wire to billing later.</p>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="lp-section lp-sectionTightTop">
        <div className="lp-container">
          <div className="card lp-cardWide">
            <div className="lp-contactGrid">
              <div>
                <h2 className="lp-sectionTitle lp-noMargin">Ready to launch?</h2>
                <p className="lp-sectionSub lp-subTight">Get set up fast. Clean roles, clean tenants, clean inventory.</p>

                <div className="lp-trustRow" style={{ marginTop: 14 }}>
                  <span className="lp-trustPill">Responsive UI</span>
                  <span className="lp-trustPill">Secure separation</span>
                  <span className="lp-trustPill">Audit trail</span>
                </div>
              </div>

              <form className="lp-form" onSubmit={submitRequestAccess}>
                {contactError ? (
                  <div style={{ color: "#991b1b", fontSize: 12, marginBottom: 8 }}>{contactError}</div>
                ) : null}

                {contactOk ? (
                  <div style={{ color: "#065f46", fontSize: 12, marginBottom: 8 }}>
                    ✅ Request sent. We’ll reach out shortly.
                  </div>
                ) : null}

                {/* Honeypot (hidden) */}
                <input
                  type="text"
                  value={contact.website}
                  onChange={(e) => setContactField("website", e.target.value)}
                  autoComplete="off"
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
                />

                <div className="lp-formGrid2">
                  <input
                    className="input"
                    type="text"
                    placeholder="Full name"
                    value={contact.name}
                    onChange={(e) => setContactField("name", e.target.value)}
                    disabled={contactLoading}
                    required
                  />
                  <input
                    className="input"
                    type="email"
                    placeholder="Email"
                    value={contact.email}
                    onChange={(e) => setContactField("email", e.target.value)}
                    disabled={contactLoading}
                    required
                  />
                </div>

                <input
                  className="input"
                  type="text"
                  placeholder="Company / Store name"
                  value={contact.company}
                  onChange={(e) => setContactField("company", e.target.value)}
                  disabled={contactLoading}
                />

                <textarea
                  className="input"
                  rows={4}
                  placeholder="What are you managing? (products, stock, stores, users...)"
                  value={contact.message}
                  onChange={(e) => setContactField("message", e.target.value)}
                  disabled={contactLoading}
                />

                <button className="btn" type="submit" disabled={contactLoading}>
                  {contactLoading ? "Sending..." : "Request access"}
                </button>

                <div className="lp-muted lp-small">No spam. Just onboarding help.</div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-container lp-footerInner">
          <div className="lp-muted lp-small">© {year} Inventory. All rights reserved.</div>
          <div className="lp-footerLinks">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#contact">Contact</a>
            <a href="#">Privacy</a>
          </div>
        </div>
      </footer>
    </>
  );
}
