// Chrome's commands API rejects Ctrl+Alt; listen on supported web pages instead.
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && !event.repeat && event.code === 'KeyD' && !event.getModifierState('AltGraph')) {
    event.preventDefault();
    chrome.runtime.sendMessage({type:'area'}).catch(() => {});
  }
}, true);
