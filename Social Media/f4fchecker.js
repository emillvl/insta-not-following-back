(async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const username = location.pathname.replace(/\//g, '');

  async function openList(type) {
    const links = Array.from(document.querySelectorAll('a'));
    const target = links.find(link => link.getAttribute('href') === `/${username}/${type}/`);
    if (!target) throw new Error(`${type} bağlantısı bulunamadı`);
    target.click();
    await sleep(2000);
  }

  async function scrollAndCollect() {
    let attempts = 0;
    let dialog = null;

    while (attempts < 20) {
      dialog = document.querySelector('div[role="dialog"]');
      if (dialog) break;
      await sleep(500);
      attempts++;
    }
    if (!dialog) throw new Error('Modal bulunamadı');

    const possibleScrolls = Array.from(dialog.querySelectorAll('div'))
      .filter(div => div.scrollHeight > div.clientHeight && div.clientHeight > 0);

    if (possibleScrolls.length === 0) throw new Error('Kaydırılabilir alan bulunamadı');

    const scrollContainer = possibleScrolls.reduce((a, b) =>
      a.scrollHeight > b.scrollHeight ? a : b
    );

    let prevHeight = 0;
    let prevCount = 0;
    let stableLoops = 0;

    while (stableLoops < 5) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await sleep(700);

      const items = dialog.querySelectorAll('a[href^="/"][role="link"]');
      const currentCount = items.length;

      if (scrollContainer.scrollHeight === prevHeight && currentCount === prevCount) {
        stableLoops++;
      } else {
        stableLoops = 0;
        prevHeight = scrollContainer.scrollHeight;
        prevCount = currentCount;
      }
    }

    const items = dialog.querySelectorAll('a[href^="/"][role="link"]');
    return Array.from(items)
      .map(a => a.textContent.trim())
      .filter(Boolean);
  }

  async function closeModal() {
    const closeBtn = document.querySelector('div[role="dialog"] svg[aria-label="Close"]');
    if (closeBtn) {
      closeBtn.parentElement.click();
      await sleep(1500);
    }
  }

  await openList("following");
  const followingList = await scrollAndCollect();
  await closeModal();

  await openList("followers");
  const followersList = await scrollAndCollect();
  await closeModal();

  const notFollowingBack = followingList.filter(user => !followersList.includes(user));

  const box = document.createElement('div');
  box.style.position = 'fixed';
  box.style.top = '50%';
  box.style.left = '50%';
  box.style.transform = 'translate(-50%, -50%)';
  box.style.zIndex = '9999999';
  box.style.background = '#800080';
  box.style.border = '2px solid #000';
  box.style.padding = '20px 40px 20px 20px';
  box.style.maxHeight = '80vh';
  box.style.overflowY = 'auto';
  box.style.fontSize = '16px';
  box.style.fontFamily = 'sans-serif';
  box.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
  box.style.userSelect = 'text';

  box.innerHTML = `
    <button id="closeF4FBox" style="position:absolute;top:10px;right:10px;background:#FF0000;border:none;padding:5px 10px;cursor:pointer;font-size:16px;color:#fff;">Kapat</button>
    <h3 style="margin-top:0;margin-bottom:10px;color:#fff;">Seni Takip Etmeyenler</h3>
    <ul style="padding-left:20px; margin:0; color:#fff;">
      ${notFollowingBack.map(u => `<li><a href="/${u}" target="_blank" rel="noopener noreferrer" style="color:#FFD700; text-decoration:none; cursor:pointer;">${u}</a></li>`).join('')}
    </ul>
  `;

  document.body.appendChild(box);

  document.getElementById('closeF4FBox').onclick = () => box.remove();
})();
