(() => {
  if(!("serviceWorker" in navigator))return;
  const banner=document.getElementById("updateBanner");
  let waitingWorker=null;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{if(waitingWorker){window.location.reload();}});
  navigator.serviceWorker.ready.then(reg=>{
    if(reg.waiting){waitingWorker=reg.waiting;banner.hidden=false;}
    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;if(!worker)return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed"&&navigator.serviceWorker.controller){waitingWorker=reg.waiting;banner.hidden=!waitingWorker;}
      });
    });
    // Cek pembaruan ketika aplikasi dibuka; browser juga melakukan pemeriksaan berkala.
    reg.update().catch(()=>{});
  });
  document.getElementById("updateNowBtn").onclick=()=>{if(waitingWorker)waitingWorker.postMessage({type:"SKIP_WAITING"});};
  document.getElementById("updateLaterBtn").onclick=()=>banner.hidden=true;
})();