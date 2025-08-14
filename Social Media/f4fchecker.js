(async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  const username = location.pathname.replace(/\//g, '');

  async function openList(type) {
    const links = Array.from(document.querySelectorAll('a'));
    const target = links.find(link => link.getAttribute('href') === `/${username}/${type}/`);
    if (!target) throw new Error(`${type} bağlantısı bulunamadı`);
    target.click();
    await sleep(3000); 
  }

  async function scrollAndCollect() {
    let attempts = 0;
    let dialog = null;

    while (attempts < 30) {
      dialog = document.querySelector('div[role="dialog"]');
      if (dialog) break;
      await sleep(500);
      attempts++;
    }
    if (!dialog) throw new Error('Modal bulunamadı');

    await sleep(2000);

    const possibleScrolls = Array.from(dialog.querySelectorAll('div'))
      .filter(div => div.scrollHeight > div.clientHeight && div.clientHeight > 0);

    if (possibleScrolls.length === 0) throw new Error('Kaydırılabilir alan bulunamadı');

    const scrollContainer = possibleScrolls.reduce((a, b) =>
      a.scrollHeight > b.scrollHeight ? a : b
    );

    let prevHeight = 0;
    let stableLoops = 0;
    const collectedUsers = new Set(); 
    let noNewUsersCount = 0;

    while (stableLoops < 8) { 
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      await sleep(1500); 

      const userLinks = dialog.querySelectorAll('a[role="link"][href^="/"]');
      const currentUsers = new Set();

      userLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('/') && href.length > 1) {
          const username = href.split('/')[1].split('?')[0];
          if (username && !username.includes('/') && username !== 'explore' && username !== 'reels') {
            currentUsers.add(username);
          }
        }
      });

      const newUsers = [...currentUsers].filter(user => !collectedUsers.has(user));
      
      if (newUsers.length === 0) {
        noNewUsersCount++;
      } else {
        noNewUsersCount = 0;
        newUsers.forEach(user => collectedUsers.add(user));
      }

      if (scrollContainer.scrollHeight === prevHeight && noNewUsersCount >= 3) {
        stableLoops++;
      } else {
        stableLoops = 0;
        prevHeight = scrollContainer.scrollHeight;
      }

      console.log(`Collected ${collectedUsers.size} users, stability: ${stableLoops}/8`);
    }

    return Array.from(collectedUsers);
  }

  async function closeModal() {
    const closeBtnSelectors = [
      'div[role="dialog"] svg[aria-label="Close"]',
      'div[role="dialog"] button[aria-label="Close"]',
      'div[role="dialog"] svg[aria-label="Kapat"]',
      'div[role="dialog"] [data-visualcompletion="css-img"]'
    ];

    for (const selector of closeBtnSelectors) {
      const closeBtn = document.querySelector(selector);
      if (closeBtn) {
        const clickableElement = closeBtn.closest('button') || closeBtn.parentElement;
        clickableElement.click();
        await sleep(2000);
        return;
      }
    }

    const backdrop = document.querySelector('div[role="dialog"]').parentElement;
    if (backdrop) {
      backdrop.click();
      await sleep(2000);
    }
  }

  console.log('Starting follower analysis...');

  try {
    console.log('Collecting following list...');
    await openList("following");
    const followingList = await scrollAndCollect();
    console.log(`Found ${followingList.length} following`);
    await closeModal();

    await sleep(2000); 

    console.log('Collecting followers list...');
    await openList("followers");
    const followersList = await scrollAndCollect();
    console.log(`Found ${followersList.length} followers`);
    await closeModal();

    const followingSet = new Set(followingList);
    const followersSet = new Set(followersList);

    const notFollowingBack = Array.from(followingSet).filter(user => !followersSet.has(user));

    console.log(`Analysis complete: ${notFollowingBack.length} users not following back`);

    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999999;
      background: #800080;
      border: 2px solid #000;
      padding: 20px 40px 20px 20px;
      max-height: 80vh;
      overflow-y: auto;
      font-size: 16px;
      font-family: sans-serif;
      box-shadow: 0 0 20px rgba(0,0,0,0.5);
      user-select: text;
      border-radius: 8px;
      max-width: 400px;
      min-width: 300px;
    `;

    box.innerHTML = `
      <button id="closeF4FBox" style="position:absolute;top:10px;right:10px;background:#FF0000;border:none;padding:5px 10px;cursor:pointer;font-size:16px;color:#fff;border-radius:4px;">✕</button>
      <h3 style="margin-top:0;margin-bottom:15px;color:#fff;">Seni Takip Etmeyenler (${notFollowingBack.length})</h3>
      <div style="margin-bottom:10px;color:#ddd;font-size:14px;">
        Takip Ettiğin: ${followingList.length} | Takipçi: ${followersList.length}
      </div>
      <ul style="padding-left:20px; margin:0; color:#fff; list-style-type: disc;">
        ${notFollowingBack.map(u => `<li style="margin-bottom:5px;"><a href="/${u}" target="_blank" rel="noopener noreferrer" style="color:#FFD700; text-decoration:none; cursor:pointer;">${u}</a></li>`).join('')}
      </ul>
    `;

    document.body.appendChild(box);

    document.getElementById('closeF4FBox').onclick = () => box.remove();

  } catch (error) {
    console.error('Error during analysis:', error);
    alert(`Hata: ${error.message}`);
  }
})();

// All rights & code belongs to the author(Emil Veliyev). Enjoy !!!
