chrome.runtime.getManifest().version + ' | ' + (chrome.storage.local.get('wa.config').then ? 'ok' : '')
