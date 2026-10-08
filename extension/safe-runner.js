void F4FAdapter.run(async ({ document, alert }) => {
return (async () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  const username = location.pathname.replace(/\//g, '');

  async function openList(type) { await F4FCollector.open(type); }

  async function scrollAndCollect() { return F4FCollector.collect(); }

  async function closeModal() { await F4FCollector.close(); }

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
}, F4FCollector);
