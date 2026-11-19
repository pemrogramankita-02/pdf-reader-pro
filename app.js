(() => {
  const $ = id => document.getElementById(id);
  const state = {docs:[], sortNewest:true, currentDoc:null};
  const fmt = n => n < 1024*1024 ? (n/1024).toFixed(0)+" KB" : (n/1024/1024).toFixed(1)+" MB";
  window.toast = message => { const el=$("toast"); el.textContent=message; el.classList.add("show"); clearTimeout(window._toastTimer); window._toastTimer=setTimeout(()=>el.classList.remove("show"),2400); };
  function safeName(s){return String(s||"Dokumen PDF").replace(/[<>]/g,"");}
  async function refreshDocs(){
    state.docs=await PDFDB.allDocs();
    state.docs.sort((a,b)=>state.sortNewest?b.updatedAt-a.updatedAt:a.name.localeCompare(b.name));
    renderDocs();
  }
  function renderDocs(){
    const q=$("searchInput").value.toLowerCase();
    const docs=state.docs.filter(d=>d.name.toLowerCase().includes(q));
    $("docCount").textContent=state.docs.length+" dokumen";
    $("documentList").innerHTML="";
    $("emptyState").hidden=docs.length!==0;
    docs.forEach(doc=>{
      const card=document.createElement("article"); card.className="doc-card";
      const icon=document.createElement("div");icon.className="doc-icon";icon.textContent="▤";
      const info=document.createElement("div");info.className="doc-info";
      const title=document.createElement("strong");title.textContent=doc.name;
      const meta=document.createElement("small");meta.textContent=fmt(doc.size)+" · "+(doc.pages?doc.pages+" halaman":"PDF")+(doc.lastPage?" · Hal. "+doc.lastPage:"");
      info.append(title,meta);
      const open=document.createElement("button");open.className="doc-open";open.textContent="›";open.setAttribute("aria-label","Buka "+doc.name);open.onclick=()=>openDoc(doc.id);
      const del=document.createElement("button");del.className="doc-delete";del.textContent="×";del.setAttribute("aria-label","Hapus "+doc.name);del.onclick=()=>deleteDoc(doc.id);
      card.append(icon,info,open,del);$("documentList").append(card);
    });
  }
  async function importFiles(files){
    for(const file of files){
      if(file.type!=="application/pdf"&&!file.name.toLowerCase().endsWith(".pdf")){toast("File bukan PDF: "+file.name);continue;}
      if(file.size>150*1024*1024){toast("File terlalu besar (maksimum awal 150 MB).");continue;}
      const id=crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2);
      await PDFDB.putDoc({id,name:safeName(file.name),blob:file,size:file.size,type:"application/pdf",createdAt:Date.now(),updatedAt:Date.now(),pages:0,lastPage:1,rotation:0});
    }
    await refreshDocs();toast("PDF berhasil disimpan di perangkat.");
  }
  async function openDoc(id){
    const doc=await PDFDB.getDoc(id);if(!doc)return;
    state.currentDoc=doc;
    $("libraryView").hidden=true;$("readerView").hidden=false;
    await window.PDFReader.open(doc);
  }
  async function deleteDoc(id){
    if(!confirm("Hapus dokumen ini dari perpustakaan aplikasi?"))return;
    await PDFDB.deleteDoc(id);await refreshDocs();toast("Dokumen dihapus dari aplikasi.");
  }
  function showLibrary(){ $("readerView").hidden=true;$("libraryView").hidden=false;state.currentDoc=null;refreshDocs(); }
  $("importBtn").onclick=()=>$("fileInput").click();
  $("fileInput").onchange=e=>{if(e.target.files.length)importFiles(e.target.files);e.target.value="";};
  $("searchInput").oninput=renderDocs;
  $("sortBtn").onclick=()=>{state.sortNewest=!state.sortNewest;$("sortBtn").textContent=state.sortNewest?"Terbaru ↓":"Nama A–Z";refreshDocs();};
  $("themeBtn").onclick=()=>{const next=document.documentElement.dataset.theme==="light"?"dark":"light";document.documentElement.dataset.theme=next;localStorage.setItem("pdf-theme",next);};
  const savedTheme=localStorage.getItem("pdf-theme")||"dark";document.documentElement.dataset.theme=savedTheme;
  $("homeBtn").onclick=showLibrary;$("backBtn").onclick=showLibrary;$("closeDocBtn").onclick=showLibrary;
  $("moreBtn").onclick=()=>{$("readerMenu").hidden=!$("readerMenu").hidden;};
  $("infoBtn").onclick=()=>{const d=state.currentDoc;if(d)alert("Nama: "+d.name+"\nUkuran: "+fmt(d.size)+"\nJumlah halaman: "+(d.pages||"Belum diketahui"));$("readerMenu").hidden=true;};
  $("downloadBtn").onclick=()=>{const d=state.currentDoc;if(!d)return;const url=URL.createObjectURL(d.blob);const a=document.createElement("a");a.href=url;a.download=d.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
  $("shareBtn").onclick=async()=>{const d=state.currentDoc;if(!d)return;try{const file=new File([d.blob],d.name,{type:"application/pdf"});if(navigator.canShare&&navigator.canShare({files:[file]}))await navigator.share({files:[file],title:d.name});else{const url=URL.createObjectURL(d.blob);const a=document.createElement("a");a.href=url;a.download=d.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);toast("PDF diunduh; silakan bagikan dari HP.");}}catch(e){if(e.name!=="AbortError")toast("Tidak dapat membagikan file.");}};
  window.showLibrary=showLibrary;
  refreshDocs().catch(e=>{console.error(e);toast("Penyimpanan lokal tidak dapat dibuka.");});
})();