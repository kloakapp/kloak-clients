(async () => {
  // ── Shared feature config ─────────────────────────────────────────────────
  // Single read/write to feature-config.json for all native features.
  let featureConfig = {};
  try {
    featureConfig = (await window.electronAPI.getFeatureConfig()) || {};
  } catch (e) {
    console.error("[Kloak] native-features: failed to load config:", e);
  }

  const saveFeatureConfig = () => {
    window.electronAPI.saveFeatureConfig(featureConfig).catch((e) =>
        console.error("[Kloak] native-features: failed to save config:", e)
    );
  };

  // ── STEALTH MODE ──────────────────────────────────────────────────────────
  // Remove legacy privacy-toggle state if present.
  if (featureConfig.stealthEnabled !== undefined) {
    delete featureConfig.stealthEnabled;
    saveFeatureConfig();
  }

  // ── QUICK EDIT ────────────────────────────────────────────────────────────
  {
    if (!featureConfig.quickEdit) featureConfig.quickEdit = {};
    if (featureConfig.quickEdit.maxMessages === undefined)
      featureConfig.quickEdit.maxMessages = 10;

    const maxMessages = () => featureConfig.quickEdit.maxMessages;

    let isSearching = false;

    document.addEventListener(
      "keydown",
      async (e) => {
        if (e.key !== "ArrowUp") return;

        const target = e.target;
        const isTextInput =
          target.tagName === "TEXTAREA" ||
          target.tagName === "INPUT" ||
          target.isContentEditable;
        if (!isTextInput) return;

        const value =
          target.value !== undefined ? target.value : target.textContent;
        if (value.trim() !== "") return;

        e.preventDefault();
        if (isSearching) return;
        isSearching = true;

        const messages = Array.from(
          document.querySelectorAll(
            'div[id^="message-"], div[id^="dm-message-"]'
          )
        )
          .reverse()
          .slice(0, maxMessages());

        for (const msg of messages) {
          const editBtn = msg.querySelector('button[aria-label="Edit"]');

          if (editBtn) {
            editBtn.click();

            let attempts = 0;
            const focusInterval = setInterval(() => {
              attempts++;
              const editBox = msg.querySelector("textarea");

              if (editBox) {
                clearInterval(focusInterval);
                editBox.focus();
                const textLen = editBox.value.length;
                editBox.setSelectionRange(textLen, textLen);

                setTimeout(() => {
                  editBox.focus();
                  editBox.setSelectionRange(textLen, textLen);
                  const messageContainer = editBox.closest(".group") || msg;
                  messageContainer.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                  });
                }, 50);
              } else if (attempts > 50) {
                clearInterval(focusInterval);
              }
            }, 10);

            isSearching = false;
            return;
          }
        }

        isSearching = false;
      },
      true
    );
  }
})();
