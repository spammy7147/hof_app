async function configureExtension() {
  await Promise.all([
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]);
}

configureExtension().catch(console.error);
