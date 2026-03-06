if (window.electronAPI && !window.electron) {
  window.electron = {
    minimize: () => window.electronAPI.minimize(),
    maximize: () => window.electronAPI.maximize(),
    close: () => window.electronAPI.close(),
    send: (channel) => {
      const c = channel?.toLowerCase() || "";
      if (c === "minimize") window.electronAPI.minimize();
      else if (c === "maximize") window.electronAPI.maximize();
      else if (c === "close") window.electronAPI.close();
      else window.electronAPI.send(channel);
    },
  };
}

if (window.electronAPI) {
  window.electronAPI.onModalEvent((type, detail) => {
    if (window.electronAPI.log)
      window.electronAPI.log(`[Kloak] Modal Event Received: ${type}`);

    if (type === "update-status") {
      renderUpdateBanner(detail);
    } else if (type === "update-progress") {
      updateProgressModal(detail);
    } else if (type === "show-custom-permission") {
      renderPermissionModal(detail);
    } else if (type === "show-screen-picker") {
      renderScreenPicker(detail);
    }
  });

  // Destructive Action Hijacker

  const handleDestructiveIntercept = (e) => {
    let target =
      e.target.closest(".text-destructive") ||
      e.target.closest('div[role="menuitem"]');

    // Verify it's actually a "Leave", "Quit", or "Exit" action
    if (target && !/Leave|Quit|Exit/i.test(target.textContent || "")) {
      target = null;
    }

    // If it's not the button, or currently not doing a synthetic click playback, let it pass
    if (!target || target.dataset.kloakBypass) return;

    // Stop the event instantly so the menu stays open
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Only trigger the modal on the initial 'pointerdown' (ignore the trailing mousedown/click)
    if (e.type === "pointerdown") {
      if (document.querySelector(".kloak-modal-overlay")) return;

      renderDestructiveModal(
        "Leave Server",
        "Are you sure you want to leave this server? This action cannot be undone.",
        "Leave Server",
        (confirmed) => {
          if (confirmed) {
            // Allow our synthetic events to bypass this interceptor
            target.dataset.kloakBypass = "true";

            // Temporarily override the app's native confirm to auto-approve instantly
            const origConfirm = window.confirm;
            window.confirm = () => true;

            // Left-click sequence that Radix will accept
            const optsDown = {
              bubbles: true,
              cancelable: true,
              view: window,
              button: 0,
              buttons: 1,
            };
            const optsUp = {
              bubbles: true,
              cancelable: true,
              view: window,
              button: 0,
              buttons: 0,
            };

            target.dispatchEvent(new PointerEvent("pointerdown", optsDown));
            target.dispatchEvent(new MouseEvent("mousedown", optsDown));
            target.dispatchEvent(new PointerEvent("pointerup", optsUp));
            target.dispatchEvent(new MouseEvent("mouseup", optsUp));
            target.dispatchEvent(new MouseEvent("click", optsUp));

            // Clean up the bypass and restore native confirm after the API fires
            setTimeout(() => {
              window.confirm = origConfirm;
              if (target) delete target.dataset.kloakBypass;
            }, 500);
          } else {
            // If they cancel, cleanly close the background menu for them
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
          }
        },
      );
    }
  };

  // Intercept all phases of the click to completely paralyze Radix
  document.addEventListener("pointerdown", handleDestructiveIntercept, true);
  document.addEventListener("mousedown", handleDestructiveIntercept, true);
  document.addEventListener("pointerup", handleDestructiveIntercept, true);
  document.addEventListener("mouseup", handleDestructiveIntercept, true);
  document.addEventListener("click", handleDestructiveIntercept, true);
  // End of Destructive Action Hijacker

  let updateBannerDismissed = false;

  function renderUpdateBanner(data) {
    if (updateBannerDismissed) return;
    if (document.getElementById("kloak-update-banner")) return;
    if (data.available === false) return;

    const banner = document.createElement("div");
    banner.id = "kloak-update-banner";
    banner.innerHTML = `
      <div class="update-content">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        <span>Update Available: ${data.version}</span>
      </div>
      <div class="update-actions">
        <div class="update-now" title="Update Now">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><path d="M22 10 16 12 18 18z"/></svg>
        </div>
        <div class="update-close" title="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </div>
      </div>
    `;

    banner.querySelector(".update-content").onclick = () =>
      window.electronAPI.openExternalUrl(data.url);
    banner.querySelector(".update-now").onclick = (e) => {
      e.stopPropagation();
      renderUpdateProgressModal(data);
      window.electronAPI.startUpdate(data.version);
      banner.remove();
    };
    banner.querySelector(".update-close").onclick = (e) => {
      e.stopPropagation();
      updateBannerDismissed = true;
      banner.classList.add("kloak-fade-out");
      setTimeout(() => banner.remove(), 300);
    };

    document.body.appendChild(banner);
  }

  function renderUpdateProgressModal(data) {
    if (document.getElementById("update-progress-modal")) return;

    const overlay = document.createElement("div");
    overlay.className = "kloak-modal-overlay";
    overlay.id = "update-progress-modal";
    overlay.innerHTML = `
      <div class="kloak-modal-container modal-neutral">
        <div class="kloak-modal-header">
          <div class="kloak-modal-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          </div>
          <div class="kloak-modal-title-group">
            <h3 class="kloak-modal-title">Updating Kloak</h3>
            <p class="kloak-modal-subtitle">Downloading version ${data.version}</p>
          </div>
        </div>
        <div class="kloak-modal-body">
          <div class="kloak-progress-container">
            <div id="update-progress-bar" class="kloak-progress-bar" style="width: 0%"></div>
          </div>
          <div id="update-status-text" class="kloak-progress-status">Initializing...</div>
        </div>
        <div class="kloak-modal-footer">
          <button id="update-cancel" class="kloak-btn-secondary">Cancel</button>
          <button id="update-restart" class="kloak-btn-primary" disabled>Restart App</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector("#update-cancel").onclick = () => {
      overlay.remove();
    };

    overlay.querySelector("#update-restart").onclick = () => {
      window.electronAPI.quitAndInstall();
    };
  }

  function updateProgressModal(status) {
    const overlay = document.getElementById("update-progress-modal");
    if (!overlay) return;

    if (status.error) {
      overlay.querySelector("#update-status-text").textContent =
        "Error: " + status.error;
      overlay.querySelector("#update-status-text").style.color =
        "#EB1414";
      const cancelBtn = overlay.querySelector("#update-cancel");
      cancelBtn.style.display = "";
      cancelBtn.textContent = "Dismiss";
      return;
    }

    if (status.progress !== undefined) {
      overlay.querySelector("#update-progress-bar").style.width =
        status.progress + "%";
    }

    if (status.status) {
      overlay.querySelector("#update-status-text").textContent = status.status;
    }

    if (status.progress === 100) {
      overlay.querySelector("#update-restart").disabled = false;
      overlay.querySelector("#update-cancel").style.display = "none";
    }
  }

  window.kloakDebugUpdate = () => {
    window.electronAPI.triggerDebugUpdate();
  };

  function renderPermissionModal(data) {
    const isMedia = data.permission === "media";
    const iconPath = isMedia
      ? '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>'
      : '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';

    const overlay = document.createElement("div");
    overlay.className = "kloak-modal-overlay";
    overlay.innerHTML = `
            <div class="kloak-modal-container modal-warning kloak-shake">
                <div class="kloak-modal-header">
                    <div class="kloak-modal-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
                    </div>
                    <div class="kloak-modal-title-group">
                        <h3 class="kloak-modal-title">Permission Request</h3>
                        <p class="kloak-modal-subtitle">Kloak wants to access your ${data.permission}</p>
                    </div>
                </div>
                <div class="kloak-modal-body">
                    If you allow this, the app will be able to access your device's hardware or data. You can revoke this later in settings.
                </div>
                <div class="kloak-modal-footer">
                    <button id="perm-deny" class="kloak-btn-secondary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Deny</button>
                    <button id="perm-allow" class="kloak-btn-primary kloak-text-warning"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Allow</button>
                </div>
            </div>
        `;
    document.body.appendChild(overlay);
    overlay.querySelector("#perm-allow").onclick = () => {
      window.electronAPI.permissionResponse(data.id, true);
      overlay.remove();
    };
    overlay.querySelector("#perm-deny").onclick = () => {
      window.electronAPI.permissionResponse(data.id, false);
      overlay.remove();
    };
  }

  function renderScreenPicker(sources) {
    const screens = sources.filter((src) => src.kind === "screen");
    const windows = sources.filter((src) => src.kind === "window");
    const initialTab = screens.length > 0 ? "screen" : "window";

    const overlay = document.createElement("div");
    overlay.className = "kloak-modal-overlay";
    overlay.innerHTML = `
            <div class="kloak-modal-container modal-neutral kloak-picker-modal">
                <div class="kloak-modal-header">
                    <div class="kloak-modal-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    </div>
                    <div class="kloak-modal-title-group">
                        <h3 class="kloak-modal-title">Select Screen or Window</h3>
                        <p class="kloak-modal-subtitle">Choose what to share, then select a source</p>
                    </div>
                </div>
                <div class="kloak-picker-tabs" role="tablist" aria-label="Share source type">
                    <button type="button" id="picker-tab-screen" class="kloak-picker-tab" data-tab="screen" role="tab" aria-selected="${initialTab === "screen"}">Screens <span>${screens.length}</span></button>
                    <button type="button" id="picker-tab-window" class="kloak-picker-tab" data-tab="window" role="tab" aria-selected="${initialTab === "window"}">Windows <span>${windows.length}</span></button>
                </div>
                <div id="picker-empty" class="kloak-picker-empty" hidden>No sources available in this group.</div>
                <div id="sources-grid" class="kloak-screen-picker-grid"></div>
                <div class="kloak-modal-footer mt-24">
                    <button id="picker-cancel" class="kloak-btn-secondary">Cancel</button>
                </div>
            </div>
        `;
    document.body.appendChild(overlay);
    const grid = overlay.querySelector("#sources-grid");
    const empty = overlay.querySelector("#picker-empty");

    const renderTab = (tab) => {
      const activeSources = tab === "screen" ? screens : windows;
      overlay.querySelectorAll(".kloak-picker-tab").forEach((btn) => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });

      grid.innerHTML = "";

      if (activeSources.length === 0) {
        empty.hidden = false;
        return;
      }

      empty.hidden = true;
      activeSources.forEach((src) => {
        const badge = src.kind === "screen" ? "Display" : "Window";
        const card = document.createElement("button");
        card.type = "button";
        card.className = "kloak-screen-source-card";
        card.innerHTML = `
          <div class="kloak-screen-source-thumb">
            <img src="${src.thumbnail}" alt="${src.name}">
          </div>
          <div class="kloak-screen-source-meta">
            <div class="kloak-screen-source-name" title="${src.name}">${src.name}</div>
            <div class="kloak-screen-source-kind">${badge}</div>
          </div>
        `;
        card.onclick = () => {
          window.electronAPI.screenShareSelected(src.id);
          overlay.remove();
        };
        grid.appendChild(card);
      });
    };

    overlay.querySelectorAll(".kloak-picker-tab").forEach((btn) => {
      btn.onclick = () => renderTab(btn.dataset.tab);
    });

    renderTab(initialTab);

    overlay.querySelector("#picker-cancel").onclick = () => {
      window.electronAPI.screenShareSelected(null);
      overlay.remove();
    };
  }

  function renderDestructiveModal(title, message, confirmText, callback) {
    const overlay = document.createElement("div");
    overlay.className = "kloak-modal-overlay";

    // Override pointer events to bypass background traps
    overlay.classList.add("pointer-events-auto");
    overlay.tabIndex = -1;

    overlay.innerHTML = `
            <div class="kloak-modal-container modal-destructive kloak-shake" tabIndex="0">
                <div class="kloak-modal-header">
                    <div class="kloak-modal-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
                    </div>
                    <div class="kloak-modal-title-group">
                        <h3 class="kloak-modal-title">${title}</h3>
                        <p class="kloak-modal-subtitle">Destructive Action</p>
                    </div>
                </div>
                <div class="kloak-modal-body">${message}</div>
                <div class="kloak-modal-footer">
                    <button id="dest-cancel" class="kloak-btn-secondary">Cancel</button>
                    <button id="dest-confirm" class="kloak-btn-primary kloak-text-destructive"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> ${confirmText}</button>
                </div>
            </div>
        `;
    document.body.appendChild(overlay);

    // Focus management with animation delay
    setTimeout(() => {
      const cancelBtn = overlay.querySelector("#dest-cancel");
      if (cancelBtn) {
        cancelBtn.focus({ preventScroll: true });

        // Force focus event
        cancelBtn.dispatchEvent(new FocusEvent("focus"));
      }
    }, 150);

    // Fallback focus check
    setTimeout(() => {
      const cancelBtn = overlay.querySelector("#dest-cancel");
      if (cancelBtn && document.activeElement !== cancelBtn) {
        cancelBtn.focus({ preventScroll: true });
      }
    }, 500);

    overlay.querySelector("#dest-confirm").onclick = () => {
      callback(true);
      overlay.remove();
    };
    overlay.querySelector("#dest-cancel").onclick = () => {
      callback(false);
      overlay.remove();
    };
  }
  // End of Modal Renderers

  // Top Bar Branding Injection

  function setupTopBarBranding() {
    const bar = document.querySelector('.h-9.w-full.border-b');
    if (!bar || document.getElementById('kloak-topbar-brand')) return;

    const label = document.createElement('div');
    label.id = 'kloak-topbar-brand';
    label.textContent = 'Kloak';
    label.setAttribute('data-tauri-drag-region', 'true');
    label.style.cssText = [
      'display: flex',
      'align-items: center',
      'padding: 0 12px',
      'font-size: 13px',
      'font-weight: 600',
      'letter-spacing: 0.02em',
      'color: var(--foreground)',
      'opacity: 0.75',
      'flex-shrink: 0',
      'pointer-events: none',
      'user-select: none',
    ].join('; ');

    bar.insertBefore(label, bar.firstChild);
  }

  // Re-apply branding on SPA navigation
  const _brandingObserver = new MutationObserver(() => {
    if (!document.getElementById('kloak-topbar-brand')) {
      setupTopBarBranding();
    }
  });

  _brandingObserver.observe(document.body, { childList: true, subtree: true });
  setupTopBarBranding();

  // End of Top Bar Branding Injection

  function hideNativeWindowControls() {
    const elements = Array.from(document.querySelectorAll("[aria-label]"));
    elements.forEach((el) => {
      const label = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      if (!/^(minim|maxim|close)/i.test(label)) return;
      if (el.dataset.kloakHidden === "true") return;

      el.dataset.kloakHidden = "true";
      el.style.display = "none";
      el.style.pointerEvents = "none";
    });
  }

  function setupTopBarButtons() {
    hideNativeWindowControls();
  }

  // Handle SPA re-renders
  setInterval(() => {
    setupTopBarButtons();
  }, 1000);
  setupTopBarButtons();

  // End of Top Bar Window Controls
}
