(function () {
  "use strict";

  var clickCount = 0;

  function selectElement(id) {
    return document.getElementById(id);
  }

  function formatMessage(count) {
    if (count === 1) {
      return "Button clicked once — fixture is live.";
    }
    return "Button clicked " + count + " times.";
  }

  function updateStatus(message) {
    var statusNode = selectElement("status");
    if (!statusNode) {
      return;
    }
    statusNode.textContent = message;
  }

  function handleGoClick(event) {
    event.preventDefault();
    clickCount += 1;
    updateStatus(formatMessage(clickCount));
  }

  function bindGoButton() {
    var goButton = selectElement("go");
    if (!goButton) {
      console.warn("[navigo-fixture] #go button not found");
      return;
    }
    goButton.addEventListener("click", handleGoClick);
  }

  function boot() {
    bindGoButton();
    updateStatus("Ready — click Get started.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
