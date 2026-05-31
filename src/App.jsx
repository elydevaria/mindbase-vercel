import { useState, useRef, useEffect } from "react";

const API = "";

// ─── Username / Identity ──────────────────────────────────────────
function getStoredUsername() {
  return localStorage.getItem("mindbase_username") || null;
}
function setStoredUsername(name) {
  localStorage.setItem("mindbase_username", name);
}

// ─── Tag system ───────────────────────────────────────────────────
const PRESET_TAGS = [
  "TDAH","Dépression","Anxiété","TSPT","TCA","TOC","Schizophrénie","Borderline",
  "Enfants","Adolescents","Adultes","Personnes âgées",
  "Protocole","Livre","Vidéo","Recherche","Recommandation HAS","Communauté",
  "Ressource patient","Ressource praticien","Formation","Outil d'évaluation",
  "Instagram","Facebook","YouTube","Reddit",
];
const TAG_COLORS = {
  "TDAH":"#e8f0fa","Dépression":"#eeecf7","Anxiété":"#eaf3ee","TSPT":"#fdf3e3",
  "TCA":"#fceaea","TOC":"#f0ede6","Schizophrénie":"#fbeaf0","Borderline":"#faece7",
  "Enfants":"#e1f5ee","Adolescents":"#eaf3ee","Adultes":"#f0ede6","Personnes âgées":"#f5f3ee",
  "Protocole":"#e8f0fa","Livre":"#eeecf7","Vidéo":"#fceaea","Recherche":"#eaf3ee",
  "Recommandation HAS":"#e8f0fa","Communauté":"#f0ede6","Ressource patient":"#fdf3e3",
  "Ressource praticien":"#eaf3ee","Formation":"#eeecf7","Outil d'évaluation":"#f5f3ee",
  "Instagram":"#fbeaf0","Facebook":"#e8f0fa","YouTube":"#fceaea","Reddit":"#fdf3e3",
};
const TAG_TEXT = {
  "TDAH":"#1a4a7a","Dépression":"#4a3f7a","Anxiété":"#2d5a3d","TSPT":"#92560a",
  "TCA":"#8b2020","TOC":"#5f5e5a","Schizophrénie":"#993556","Borderline":"#993c1d",
  "Enfants":"#0f6e56","Adolescents":"#2d5a3d","Adultes":"#5f5e5a","Personnes âgées":"#6b6560",
  "Protocole":"#1a4a7a","Livre":"#4a3f7a","Vidéo":"#8b2020","Recherche":"#2d5a3d",
  "Recommandation HAS":"#1a4a7a","Communauté":"#5f5e5a","Ressource patient":"#92560a",
  "Ressource praticien":"#2d5a3d","Formation":"#4a3f7a","Outil d'évaluation":"#6b6560",
  "Instagram":"#993556","Facebook":"#1a4a7a","YouTube":"#8b2020","Reddit":"#92560a",
};

function TagPill({ tag, onRemove, small }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:small?10:11, padding:small?"2px 7px":"3px 9px", borderRadius:20, background:TAG_COLORS[tag]||"#f0ede6", color:TAG_TEXT[tag]||"#5f5e5a", border:`1px solid ${TAG_TEXT[tag]||"#cec9bf"}30`, fontWeight:500 }}>
      {tag}{onRemove && <span onClick={onRemove} style={{ cursor:"pointer", marginLeft:2, opacity:0.6 }}>×</span>}
    </span>
  );
}

// ─── Render helpers ───────────────────────────────────────────────
function renderInline(text) {
  const cleaned = text
    .replace(/\[+🔗\s*\]\([^)]+\)/g, "")
    .replace(/\[+🔗\s*/g, "")
    .replace(/\]+$/g, "");
  const parts = [];
  const re = /(\[([^\]]*)\]\((https?:\/\/[^\)]+)\))|(\*\*(.*?)\*\*)|(https?:\/\/[^\s\)\]>"]+)/g;
  let last = 0, m;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{cleaned.slice(last, m.index)}</span>);
    if (m[1]) {
      const url = m[3].replace(/[\)\]>.,;:!?]+$/, "");
      const label = m[2].replace(/🔗\s*/g, "").trim() || url;
      parts.push(<a key={m.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color:"#2d5a3d", fontSize:12, borderBottom:"1px solid #a8cdb5", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:3 }}>🔗 {label}</a>);
    } else if (m[4]) {
      parts.push(<strong key={m.index}>{m[5]}</strong>);
    } else if (m[6]) {
      const url = m[6].replace(/[\)\]>.,;:!?]+$/, "");
      parts.push(<a key={m.index} href={url} target="_blank" rel="noopener noreferrer" style={{ color:"#2d5a3d", fontSize:11, wordBreak:"break-all", borderBottom:"1px solid #a8cdb5", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:3 }}>🔗 {url}</a>);
    }
    last = re.lastIndex;
  }
  if (last < cleaned.length) parts.push(<span key={last}>{cleaned.slice(last)}</span>);
  return parts.length ? parts : cleaned;
}

function parseContent(text) {
  return text.split("\n").map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height:5 }} />;
    if (t.startsWith("### ")) return <div key={i} style={{ fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em", color:"#2d5a3d", marginTop:18, marginBottom:7, paddingBottom:5, borderBottom:"1px solid #e2ddd5" }}>{renderInline(t.slice(4))}</div>;
    if (t.startsWith("## ")) return <div key={i} style={{ fontSize:14, fontWeight:600, color:"#1c1917", marginTop:12, marginBottom:4 }}>{renderInline(t.slice(3))}</div>;
    if (t.startsWith("# ")) return <div key={i} style={{ fontSize:15, fontWeight:600, color:"#1c1917", marginTop:12, marginBottom:6 }}>{renderInline(t.slice(2))}</div>;
    if (t.startsWith("- ") || t.startsWith("• ")) return <div key={i} style={{ display:"flex", gap:8, padding:"3px 0 3px 10px", borderLeft:"2px solid #a8cdb5", margin:"3px 0" }}><span style={{ fontSize:12, color:"#3a3530", lineHeight:1.65, flex:1 }}>{renderInline(t.slice(2))}</span></div>;
    if (/^\d+\.\s/.test(t)) return <div key={i} style={{ fontSize:12, color:"#3a3530", lineHeight:1.65, paddingLeft:8, margin:"2px 0" }}>{renderInline(t)}</div>;
    return <div key={i} style={{ fontSize:13, color:"#1c1917", lineHeight:1.75, marginBottom:1 }}>{renderInline(t)}</div>;
  });
}

// ─── PDF download ─────────────────────────────────────────────────
function downloadAsPdf(text, title) {
  const cleanTitle = title.replace(/[#*📚▶️📸👥💬🔗🐦🔬📄📋]/g, "").trim().slice(0, 50);

  const formatLine = (line) => {
    const t = line.trim();
    if (!t) return "<br>";
    const linkify = s => s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
    if (t.startsWith("### ")) return '<div class="section">' + linkify(t.slice(4)) + "</div>";
    if (t.startsWith("## ")) return '<h2 style="font-size:15px;color:#1c1917">' + linkify(t.slice(3)) + "</h2>";
    if (t.startsWith("- ") || t.startsWith("• ")) return '<div class="item">' + linkify(t.slice(2)) + "</div>";
    return '<p style="margin:3px 0">' + linkify(t) + "</p>";
  };

  const body = text.split("\n").map(formatLine).join("\n");
  const date = new Date().toLocaleDateString("fr-FR", { day:"numeric", month:"long", year:"numeric" });

  const html = [
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>" + cleanTitle + "</title>",
    "<style>",
    "@media print { .no-print { display:none!important } @page { margin:20mm } }",
    "body { font-family:Georgia,serif; max-width:750px; margin:40px auto; color:#1c1917; line-height:1.7; font-size:13px }",
    "h1 { font-size:18px; color:#2d5a3d; border-bottom:2px solid #2d5a3d; padding-bottom:8px; margin-bottom:20px }",
    ".section { font-weight:bold; font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:#2d5a3d; margin-top:20px; margin-bottom:6px; border-bottom:1px solid #e2ddd5; padding-bottom:4px }",
    ".item { margin:6px 0 6px 12px; border-left:2px solid #a8cdb5; padding-left:8px }",
    "a { color:#2d5a3d } .footer { margin-top:40px; font-size:11px; color:#a09a93; border-top:1px solid #e2ddd5; padding-top:10px }",
    ".print-btn { display:block; margin:0 auto 24px; padding:10px 24px; background:#2d5a3d; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; font-family:system-ui,sans-serif }",
    "</style></head><body>",
    "<button class='print-btn no-print' onclick='window.print()'>📄 Enregistrer en PDF</button>",
    "<h1>MindBase — " + cleanTitle + "</h1>",
    body,
    "<div class='footer'>Généré par MindBase · " + date + "</div>",
    "</body></html>"
  ].join("\n");

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;";
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => { try { document.body.removeChild(iframe); } catch(e) {} }, 3000);
  }, 400);
}

// ─── Username modal ───────────────────────────────────────────────
function UsernameModal({ onConfirm }) {
  const [step, setStep] = useState("choose"); // choose | login
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function checkAndCreate() {
    const name = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (name.length < 3) { setError("Minimum 3 caractères (lettres, chiffres, - ou _)"); return; }
    if (name.length > 30) { setError("Maximum 30 caractères"); return; }
    setLoading(true);
    setError("");
    try {
      // Check if username exists in Supabase
      const res = await fetch(`${API}/api/library?userId=${encodeURIComponent(name)}&check=1`);
      const data = await res.json();
      if (data.exists && step === "choose") {
        setError("Ce nom d'utilisateur est déjà pris. Choisissez-en un autre ou connectez-vous avec ce nom si c'est le vôtre.");
        setLoading(false);
        return;
      }
      setStoredUsername(name);
      onConfirm(name);
    } catch (e) {
      // If check fails, just proceed — worst case two users share a library
      setStoredUsername(name);
      onConfirm(name);
    }
    setLoading(false);
  }

  function login() {
    const name = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (name.length < 3) { setError("Nom d'utilisateur invalide"); return; }
    setStoredUsername(name);
    onConfirm(name);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#fff", borderRadius:16, padding:32, width:440, maxWidth:"92vw" }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:22, color:"#2d5a3d", marginBottom:8 }}>Bienvenue sur MindBase</div>

        {step === "choose" ? <>
          <div style={{ fontSize:13, color:"#4a4540", lineHeight:1.7, marginBottom:20 }}>
            Choisissez un <strong>nom d'utilisateur</strong> pour accéder à votre bibliothèque personnelle depuis n'importe quel appareil.<br/><br/>
            <span style={{ fontSize:12, color:"#6b6560", background:"#f5f3ee", padding:"8px 12px", borderRadius:8, display:"block", lineHeight:1.6 }}>
              💡 Ce nom est uniquement utilisé pour retrouver vos ressources sauvegardées. Aucun email ni mot de passe requis. Choisissez quelque chose de mémorable et unique.
            </span>
          </div>
          <div style={{ marginBottom:14 }}>
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && checkAndCreate()}
              placeholder="ex: dr_martin_75, marie_psy, therapeute_lyon"
              style={{ width:"100%", padding:"10px 14px", border:`1px solid ${error?"#f09595":"#e2ddd5"}`, borderRadius:8, fontSize:13, color:"#1c1917", fontFamily:"system-ui,sans-serif", outline:"none", background:"#f5f3ee" }}
              autoFocus
            />
            {error && <div style={{ fontSize:12, color:"#8b2020", marginTop:6 }}>{error}</div>}
            <div style={{ fontSize:11, color:"#a09a93", marginTop:5 }}>Lettres minuscules, chiffres, tirets et underscores uniquement</div>
          </div>
          <button onClick={checkAndCreate} disabled={loading || username.trim().length < 3}
            style={{ width:"100%", padding:"11px", background:loading||username.trim().length<3?"#cec9bf":"#2d5a3d", color:"#fff", border:"none", borderRadius:10, fontSize:13, cursor:loading||username.trim().length<3?"not-allowed":"pointer", fontWeight:500, fontFamily:"system-ui,sans-serif", marginBottom:12 }}>
            {loading ? "Vérification..." : "Créer mon espace →"}
          </button>
          <button onClick={() => { setStep("login"); setError(""); setUsername(""); }}
            style={{ width:"100%", padding:"9px", background:"none", border:"1px solid #e2ddd5", borderRadius:10, fontSize:12, cursor:"pointer", color:"#6b6560", fontFamily:"system-ui,sans-serif" }}>
            J'ai déjà un nom d'utilisateur — me connecter
          </button>
        </> : <>
          <div style={{ fontSize:13, color:"#4a4540", lineHeight:1.7, marginBottom:20 }}>
            Entrez votre nom d'utilisateur existant pour retrouver votre bibliothèque.
          </div>
          <div style={{ marginBottom:14 }}>
            <input
              value={username}
              onChange={e => { setUsername(e.target.value); setError(""); }}
              onKeyDown={e => e.key === "Enter" && login()}
              placeholder="Votre nom d'utilisateur"
              style={{ width:"100%", padding:"10px 14px", border:`1px solid ${error?"#f09595":"#e2ddd5"}`, borderRadius:8, fontSize:13, color:"#1c1917", fontFamily:"system-ui,sans-serif", outline:"none", background:"#f5f3ee" }}
              autoFocus
            />
            {error && <div style={{ fontSize:12, color:"#8b2020", marginTop:6 }}>{error}</div>}
          </div>
          <button onClick={login} disabled={username.trim().length < 3}
            style={{ width:"100%", padding:"11px", background:username.trim().length<3?"#cec9bf":"#2d5a3d", color:"#fff", border:"none", borderRadius:10, fontSize:13, cursor:username.trim().length<3?"not-allowed":"pointer", fontWeight:500, fontFamily:"system-ui,sans-serif", marginBottom:12 }}>
            Accéder à ma bibliothèque →
          </button>
          <button onClick={() => { setStep("choose"); setError(""); setUsername(""); }}
            style={{ width:"100%", padding:"9px", background:"none", border:"1px solid #e2ddd5", borderRadius:10, fontSize:12, cursor:"pointer", color:"#6b6560", fontFamily:"system-ui,sans-serif" }}>
            ← Créer un nouveau nom d'utilisateur
          </button>
        </>}
      </div>
    </div>
  );
}

// ─── Save modal ───────────────────────────────────────────────────
function SaveModal({ message, onSave, onClose }) {
  const [title, setTitle] = useState(message.text.replace(/[#*📚▶️📸👥💬🔗🐦🔬📄📋]/g,"").split("\n")[0].trim().slice(0,60));
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTag, setCustomTag] = useState("");
  const [note, setNote] = useState("");
  function toggleTag(t) { setSelectedTags(s => s.includes(t) ? s.filter(x=>x!==t) : [...s,t]); }
  function addCustom() { const t=customTag.trim(); if(t&&!selectedTags.includes(t)){setSelectedTags(s=>[...s,t]);setCustomTag("");} }
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:26, width:480, maxWidth:"92vw", maxHeight:"85vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ fontFamily:"Georgia,serif", fontSize:18, color:"#1c1917" }}>Sauvegarder</div>
          <button onClick={onClose} style={{ border:"none", background:"none", fontSize:20, cursor:"pointer", color:"#a09a93" }}>×</button>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:"#a09a93", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:500, marginBottom:5 }}>Titre</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} style={{ width:"100%", padding:"9px 12px", border:"1px solid #e2ddd5", borderRadius:8, fontSize:13, color:"#1c1917", fontFamily:"system-ui,sans-serif", outline:"none", background:"#f5f3ee" }} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:"#a09a93", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:500, marginBottom:8 }}>Tags</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
            {PRESET_TAGS.map(tag => (
              <button key={tag} onClick={()=>toggleTag(tag)} style={{ padding:"3px 10px", borderRadius:20, border:selectedTags.includes(tag)?`1.5px solid ${TAG_TEXT[tag]||"#2d5a3d"}`:"1px solid #e2ddd5", background:selectedTags.includes(tag)?(TAG_COLORS[tag]||"#eaf3ee"):"#f5f3ee", color:selectedTags.includes(tag)?(TAG_TEXT[tag]||"#2d5a3d"):"#6b6560", fontSize:11, cursor:"pointer", fontFamily:"system-ui,sans-serif" }}>{tag}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <input value={customTag} onChange={e=>setCustomTag(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustom()} placeholder="Tag personnalisé..." style={{ flex:1, padding:"7px 10px", border:"1px solid #e2ddd5", borderRadius:8, fontSize:12, fontFamily:"system-ui,sans-serif", outline:"none", background:"#f5f3ee", color:"#1c1917" }} />
            <button onClick={addCustom} style={{ padding:"7px 14px", background:"#f0ede6", border:"1px solid #cec9bf", borderRadius:8, fontSize:12, cursor:"pointer", color:"#4a4540", fontFamily:"system-ui,sans-serif" }}>+ Ajouter</button>
          </div>
          {selectedTags.length>0 && <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:8 }}>{selectedTags.map(t=><TagPill key={t} tag={t} onRemove={()=>setSelectedTags(s=>s.filter(x=>x!==t))} />)}</div>}
        </div>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#a09a93", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:500, marginBottom:5 }}>Note (optionnel)</div>
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Ex : À partager avec mes patients TDAH..." rows={2} style={{ width:"100%", padding:"9px 12px", border:"1px solid #e2ddd5", borderRadius:8, fontSize:12, fontFamily:"system-ui,sans-serif", outline:"none", resize:"vertical", background:"#f5f3ee", color:"#1c1917" }} />
        </div>
        <button onClick={()=>onSave({title,tags:selectedTags,note,content:message.text})} style={{ width:"100%", padding:"11px", background:"#2d5a3d", color:"#fff", border:"none", borderRadius:10, fontSize:13, cursor:"pointer", fontWeight:500, fontFamily:"system-ui,sans-serif" }}>Sauvegarder →</button>
      </div>
    </div>
  );
}

// ─── Library view ─────────────────────────────────────────────────
function LibraryView({ items, onClose, onDelete }) {
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const allTags = [...new Set(items.flatMap(i=>i.tags||[]))].sort();
  const filtered = items.filter(item => {
    const ms = !search || item.title?.toLowerCase().includes(search.toLowerCase()) || item.content?.toLowerCase().includes(search.toLowerCase());
    const mt = !filterTag || (item.tags||[]).includes(filterTag);
    return ms && mt;
  });
  return (
    <div style={{ position:"fixed", inset:0, background:"#f5f3ee", zIndex:150, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"#fff", borderBottom:"1px solid #e2ddd5", padding:"14px 22px", display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ fontFamily:"Georgia,serif", fontSize:20, color:"#1c1917" }}>Ma bibliothèque</div>
        <div style={{ fontSize:12, color:"#a09a93" }}>{items.length} ressource{items.length!==1?"s":""}</div>
        <button onClick={onClose} style={{ marginLeft:"auto", padding:"7px 14px", background:"#f0ede6", border:"1px solid #cec9bf", borderRadius:20, cursor:"pointer", fontSize:12, color:"#4a4540", fontFamily:"system-ui,sans-serif" }}>← Retour</button>
      </div>
      <div style={{ padding:"12px 22px", background:"#fff", borderBottom:"1px solid #e2ddd5", display:"flex", gap:10, flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher..." style={{ flex:1, minWidth:200, padding:"8px 12px", border:"1px solid #e2ddd5", borderRadius:8, fontSize:13, fontFamily:"system-ui,sans-serif", outline:"none", background:"#f5f3ee", color:"#1c1917" }} />
        {allTags.length>0 && <div style={{ display:"flex", flexWrap:"wrap", gap:5, alignItems:"center" }}>
          <span style={{ fontSize:11, color:"#a09a93" }}>Filtrer :</span>
          {filterTag && <button onClick={()=>setFilterTag(null)} style={{ padding:"3px 8px", border:"1px solid #cec9bf", borderRadius:20, background:"#f0ede6", fontSize:11, cursor:"pointer", color:"#6b6560", fontFamily:"system-ui,sans-serif" }}>× Tout</button>}
          {allTags.map(t=><button key={t} onClick={()=>setFilterTag(filterTag===t?null:t)} style={{ padding:"3px 9px", border:filterTag===t?`1.5px solid ${TAG_TEXT[t]||"#2d5a3d"}`:"1px solid #e2ddd5", borderRadius:20, background:filterTag===t?(TAG_COLORS[t]||"#eaf3ee"):"#f5f3ee", color:filterTag===t?(TAG_TEXT[t]||"#2d5a3d"):"#6b6560", fontSize:11, cursor:"pointer", fontFamily:"system-ui,sans-serif" }}>{t}</button>)}
        </div>}
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"16px 22px", display:"flex", flexDirection:"column", gap:10 }}>
        {filtered.length===0 && <div style={{ textAlign:"center", padding:"40px 20px", color:"#a09a93", fontSize:13 }}>{items.length===0?"Bibliothèque vide — sauvegardez des réponses avec 🔖":"Aucun résultat."}</div>}
        {filtered.map((item,i)=>(
          <div key={item.id} style={{ background:"#fff", border:"1px solid #e2ddd5", borderRadius:12, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", cursor:"pointer", display:"flex", gap:10 }} onClick={()=>setExpanded(expanded===i?null:i)}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:500, fontSize:13, color:"#1c1917", marginBottom:5 }}>{item.title}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>{(item.tags||[]).map(t=><TagPill key={t} tag={t} small />)}</div>
                {item.note && <div style={{ fontSize:11, color:"#6b6560", fontStyle:"italic", marginTop:5 }}>📝 {item.note}</div>}
                <div style={{ fontSize:10, color:"#a09a93", marginTop:5 }}>{new Date(item.created_at||item.savedAt).toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})}</div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                <button onClick={e=>{e.stopPropagation();downloadAsPdf(item.content,item.title);}} title="Télécharger en PDF" style={{ border:"none", background:"none", cursor:"pointer", fontSize:14, color:"#a09a93", padding:2 }}>⬇️</button>
                <span style={{ fontSize:11, color:"#a09a93" }}>{expanded===i?"▲":"▼"}</span>
                <button onClick={e=>{e.stopPropagation();if(window.confirm("Supprimer ?"))onDelete(item.id);}} style={{ border:"none", background:"none", cursor:"pointer", fontSize:14, color:"#cec9bf" }}>🗑</button>
              </div>
            </div>
            {expanded===i && <div style={{ padding:"0 16px 14px", borderTop:"1px solid #f0ede6" }}><div style={{ fontSize:12, color:"#4a4540", lineHeight:1.7, maxHeight:300, overflowY:"auto", paddingTop:10 }}>{parseContent(item.content)}</div></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Analyse modal ────────────────────────────────────────────────
function AnalyseModal({ onAnalyse, onClose }) {
  const [urls, setUrls] = useState([""]);
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  function addUrl() { setUrls(u=>[...u,""]); }
  function updateUrl(i,v) { setUrls(u=>u.map((x,j)=>j===i?v:x)); }
  function removeUrl(i) { setUrls(u=>u.filter((_,j)=>j!==i)); }
  function addFiles(newFiles) { setFiles(f=>[...f,...Array.from(newFiles).filter(f=>f.type==="application/pdf"&&f.size<=10*1024*1024)]); }
  function removeFile(i) { setFiles(f=>f.filter((_,j)=>j!==i)); }
  const validUrls = urls.filter(u=>u.trim().match(/^https?:\/\/.+/));
  const canSubmit = validUrls.length>0||files.length>0;
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#fff", borderRadius:16, padding:26, width:500, maxWidth:"93vw", maxHeight:"88vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
          <div style={{ fontFamily:"Georgia,serif", fontSize:19, color:"#1c1917" }}>Analyser des ressources</div>
          <button onClick={onClose} style={{ border:"none", background:"none", fontSize:20, cursor:"pointer", color:"#a09a93" }}>×</button>
        </div>
        <div style={{ fontSize:12, color:"#6b6560", marginBottom:20, lineHeight:1.6 }}>Ajoutez des PDFs, des liens web, ou les deux.</div>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#a09a93", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:500, marginBottom:8 }}>🔗 Liens web</div>
          {urls.map((url,i)=>(
            <div key={i} style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input value={url} onChange={e=>updateUrl(i,e.target.value)} placeholder="https://..." style={{ flex:1, padding:"8px 11px", border:"1px solid #e2ddd5", borderRadius:8, fontSize:12, fontFamily:"system-ui,sans-serif", outline:"none", background:"#f5f3ee", color:"#1c1917" }} />
              {urls.length>1&&<button onClick={()=>removeUrl(i)} style={{ border:"none", background:"#f0ede6", borderRadius:8, padding:"0 10px", cursor:"pointer", color:"#a09a93", fontSize:16 }}>×</button>}
            </div>
          ))}
          <button onClick={addUrl} style={{ fontSize:12, color:"#2d5a3d", border:"1px dashed #a8cdb5", background:"none", padding:"6px 12px", borderRadius:8, cursor:"pointer", fontFamily:"system-ui,sans-serif" }}>+ Ajouter un lien</button>
        </div>
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#a09a93", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:500, marginBottom:8 }}>📄 Documents PDF</div>
          <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);addFiles(e.dataTransfer.files);}} onClick={()=>fileRef.current?.click()} style={{ border:`2px dashed ${dragOver?"#2d5a3d":"#cec9bf"}`, borderRadius:10, padding:"20px 16px", textAlign:"center", cursor:"pointer", background:dragOver?"#eaf3ee":"#f5f3ee", marginBottom:8 }}>
            <div style={{ fontSize:24, marginBottom:5 }}>📄</div>
            <div style={{ fontSize:13, color:"#6b6560" }}>Glissez vos PDFs ici, ou <span style={{ color:"#2d5a3d", fontWeight:500 }}>parcourir</span></div>
            <div style={{ fontSize:11, color:"#a09a93", marginTop:3 }}>Plusieurs PDFs · max 10 Mo chacun</div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display:"none" }} onChange={e=>addFiles(e.target.files)} />
          {files.length>0 && <div style={{ display:"flex", flexDirection:"column", gap:5 }}>{files.map((f,i)=><div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:"#f5f3ee", borderRadius:8, border:"1px solid #e2ddd5" }}><span>📄</span><span style={{ fontSize:12, color:"#3a3530", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span><span style={{ fontSize:10, color:"#a09a93" }}>{(f.size/1024/1024).toFixed(1)} Mo</span><button onClick={()=>removeFile(i)} style={{ border:"none", background:"none", cursor:"pointer", color:"#cec9bf", fontSize:15 }}>×</button></div>)}</div>}
        </div>
        <button onClick={()=>canSubmit&&onAnalyse({urls:validUrls,files})} disabled={!canSubmit} style={{ width:"100%", padding:"11px", background:canSubmit?"#2d5a3d":"#cec9bf", color:"#fff", border:"none", borderRadius:10, fontSize:13, cursor:canSubmit?"pointer":"not-allowed", fontWeight:500, fontFamily:"system-ui,sans-serif" }}>
          Analyser ({validUrls.length} lien{validUrls.length!==1?"s":""} + {files.length} PDF{files.length!==1?"s":""}) →
        </button>
      </div>
    </div>
  );
}

const QUICK_SUGGESTIONS = [
  "Ressources complètes sur le TDAH adulte — livres, vidéos, réseaux sociaux, recherches",
  "Ressources sur la dépression — protocoles, livres, Instagram, YouTube, forums",
  "Livres sur la thérapie DBT disponibles sur Amazon.fr et Fnac",
  "Recommandations HAS et ANSM sur les troubles anxieux 2024",
  "Communautés Reddit, LinkedIn et Facebook pour psychiatres francophones",
  "Protocoles EMDR pour le trauma complexe — niveau de preuve et formation",
];

// ─── Main app ─────────────────────────────────────────────────────
export default function MindBase() {
  const [userId, setUserId] = useState(getStoredUsername());
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [analyseOpen, setAnalyseOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState([]);
  const [toast, setToast] = useState("");
  const chatRef = useRef(null);

  useEffect(() => { if (userId) loadLibrary(userId); }, [userId]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, loading]);

  async function loadLibrary(uid) {
    try {
      const res = await fetch(`${API}/api/library?userId=${encodeURIComponent(uid)}`);
      const data = await res.json();
      setLibrary(data.items || []);
    } catch(e) { setLibrary([]); }
  }

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(""), 2500); }

  async function saveToLibrary({ title, tags, note, content }) {
    try {
      const res = await fetch(`${API}/api/library`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ userId, title, tags, note, content }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      // Reload from Supabase to ensure state matches database
      await loadLibrary(userId);
      setSaveTarget(null);
      showToast("✓ Sauvegardé dans la bibliothèque");
    } catch(e) {
      console.error("Save error:", e);
      showToast("Erreur lors de la sauvegarde — réessayez");
    }
  }

  async function deleteFromLibrary(id) {
    try {
      await fetch(`${API}/api/library?id=${id}`, { method:"DELETE" });
      await loadLibrary(userId);
    } catch(e) {
      setLibrary(l=>l.filter(i=>i.id!==id));
    }
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return;
    const newHistory = [...history, { role:"user", content:text }];
    setMessages(m=>[...m, { type:"user", text }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/chat`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ messages:newHistory.slice(-14) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHistory([...newHistory, { role:"assistant", content:data.reply }].slice(-16));
      setMessages(m=>[...m, { type:"agent", text:data.reply }]);
    } catch(e) {
      setMessages(m=>[...m, { type:"error", text:e.message }]);
    }
    setLoading(false);
  }

  async function handleAnalyse({ urls, files }) {
    setAnalyseOpen(false);
    setLoading(true);
    const label = [...urls.map(u=>u.slice(0,35)+"…"), ...files.map(f=>f.name)].join(", ");
    setMessages(m=>[...m, { type:"user", text:`📎 Analyse : ${label}` }]);
    const toBase64 = f => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res({name:f.name,data:r.result.split(",")[1]}); r.onerror=rej; r.readAsDataURL(f); });
    try {
      const pdfs = await Promise.all(files.map(toBase64));
      const res = await fetch(`${API}/api/analyse`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ urls, pdfs }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(m=>[...m, { type:"agent", text:data.reply, meta:`📎 ${[...urls,...files].length} ressource${[...urls,...files].length>1?"s":""} analysée${[...urls,...files].length>1?"s":""}` }]);
    } catch(e) {
      setMessages(m=>[...m, { type:"error", text:e.message }]);
    }
    setLoading(false);
  }

  // Show username modal if not set
  if (!userId) return <UsernameModal onConfirm={name => { setUserId(name); }} />;

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"system-ui,sans-serif", background:"#f5f3ee", overflow:"hidden" }}>
      {toast && <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", background:"#2d5a3d", color:"#fff", padding:"10px 20px", borderRadius:30, fontSize:13, zIndex:300, fontWeight:500 }}>{toast}</div>}
      {saveTarget && <SaveModal message={saveTarget} onSave={saveToLibrary} onClose={()=>setSaveTarget(null)} />}
      {showLibrary && <LibraryView items={library} onClose={()=>setShowLibrary(false)} onDelete={deleteFromLibrary} />}
      {analyseOpen && <AnalyseModal onAnalyse={handleAnalyse} onClose={()=>setAnalyseOpen(false)} />}

      {/* Sidebar */}
      <aside style={{ width:220, background:"#fff", borderRight:"1px solid #e2ddd5", display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"20px 18px 16px", borderBottom:"1px solid #e2ddd5" }}>
          <div style={{ fontFamily:"Georgia,serif", fontSize:22, color:"#2d5a3d" }}>MindBase</div>
          <div style={{ fontSize:11, color:"#a09a93", marginTop:2 }}>Agent clinique · Santé mentale</div>
          <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:10, padding:"3px 8px", background:"#eaf3ee", color:"#2d5a3d", borderRadius:20, border:"1px solid #a8cdb5", marginTop:8 }}>🇫🇷 France &amp; Europe</div>
          {/* Username display */}
          <div style={{ marginTop:10, padding:"6px 8px", background:"#f5f3ee", borderRadius:8, border:"1px solid #e2ddd5", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:11, color:"#4a4540" }}>👤 {userId}</span>
            <button onClick={()=>{ if(window.confirm("Changer d'utilisateur ? Votre bibliothèque locale sera déconnectée.")){setStoredUsername(null);setUserId(null);setLibrary([]);} }} style={{ border:"none", background:"none", fontSize:10, color:"#a09a93", cursor:"pointer", padding:0 }}>Changer</button>
          </div>
        </div>

        <button onClick={()=>{ loadLibrary(userId); setShowLibrary(true); }} style={{ margin:"12px 14px 0", padding:"10px 14px", background:library.length>0?"#eaf3ee":"#f5f3ee", border:"1px solid #a8cdb5", borderRadius:10, cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontFamily:"system-ui,sans-serif" }} onMouseEnter={e=>e.currentTarget.style.background="#d4ece0"} onMouseLeave={e=>e.currentTarget.style.background=library.length>0?"#eaf3ee":"#f5f3ee"}>
          <span style={{ fontSize:16 }}>📚</span>
          <div style={{ textAlign:"left" }}><div style={{ fontSize:13, fontWeight:500, color:"#2d5a3d" }}>Ma bibliothèque</div><div style={{ fontSize:10, color:"#6b9e7a" }}>{library.length} ressource{library.length!==1?"s":""}</div></div>
        </button>

        <button onClick={()=>setAnalyseOpen(true)} style={{ margin:"8px 14px 0", padding:"10px 14px", background:"#f5f3ee", border:"1px dashed #a8cdb5", borderRadius:10, cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontFamily:"system-ui,sans-serif" }} onMouseEnter={e=>e.currentTarget.style.background="#eaf3ee"} onMouseLeave={e=>e.currentTarget.style.background="#f5f3ee"}>
          <span style={{ fontSize:16 }}>📎</span>
          <div style={{ textAlign:"left" }}><div style={{ fontSize:13, fontWeight:500, color:"#4a4540" }}>Analyser PDFs &amp; liens</div><div style={{ fontSize:10, color:"#a09a93" }}>Plusieurs fichiers et URLs</div></div>
        </button>

        <div style={{ padding:"14px 14px 8px", borderTop:"1px solid #f0ede6", marginTop:12 }}>
          <div style={{ fontSize:10, textTransform:"uppercase", letterSpacing:"0.07em", color:"#a09a93", fontWeight:500, marginBottom:8 }}>Suggestions</div>
          {QUICK_SUGGESTIONS.map((s,i)=><button key={i} onClick={()=>sendMessage(s)} style={{ display:"block", width:"100%", textAlign:"left", padding:"7px 9px", border:"none", background:"none", fontSize:11, color:"#6b6560", borderRadius:7, cursor:"pointer", marginBottom:2, lineHeight:1.4, fontFamily:"system-ui,sans-serif" }} onMouseEnter={e=>{e.currentTarget.style.background="#eaf3ee";e.currentTarget.style.color="#2d5a3d";}} onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color="#6b6560";}}>{s.length>54?s.slice(0,54)+"…":s}</button>)}
        </div>

        <div style={{ marginTop:"auto", padding:"10px 14px", borderTop:"1px solid #e2ddd5" }}>
          <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
            {["HAS","ANSM","Inserm","OMS","PubMed","YouTube","Instagram","Facebook","Amazon.fr","Fnac","Reddit","LinkedIn"].map(s=><span key={s} style={{ fontSize:9, padding:"2px 5px", borderRadius:20, background:"#f0ede6", color:"#6b6560", border:"1px solid #e2ddd5" }}>{s}</span>)}
          </div>
        </div>
      </aside>

      {/* Chat */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div ref={chatRef} style={{ flex:1, overflowY:"auto", padding:"22px 24px 0", display:"flex", flexDirection:"column", gap:14 }}>
          {messages.length===0 && (
            <div style={{ background:"#fff", border:"1px solid #e2ddd5", borderRadius:14, padding:26 }}>
              <div style={{ fontFamily:"Georgia,serif", fontSize:25, color:"#1c1917", marginBottom:8 }}>Bonjour, <em style={{ color:"#2d5a3d" }}>{userId}</em> 👋</div>
              <div style={{ fontSize:13, color:"#6b6560", lineHeight:1.75, marginBottom:18, maxWidth:520 }}>Posez une question sur n'importe quel sujet clinique — je structure ma réponse en sections : livres, vidéos, Instagram, Facebook, Reddit, recherches, recommandations HAS. Sauvegardez et téléchargez en PDF ce qui vous est utile.</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {QUICK_SUGGESTIONS.slice(0,4).map((s,i)=><button key={i} onClick={()=>sendMessage(s)} style={{ padding:"11px 14px", background:"#f5f3ee", border:"1px solid #e2ddd5", borderRadius:10, cursor:"pointer", textAlign:"left", fontFamily:"system-ui,sans-serif", fontSize:12, color:"#3a3530", lineHeight:1.5 }} onMouseEnter={e=>{e.currentTarget.style.background="#eaf3ee";e.currentTarget.style.borderColor="#a8cdb5";}} onMouseLeave={e=>{e.currentTarget.style.background="#f5f3ee";e.currentTarget.style.borderColor="#e2ddd5";}}>{s}</button>)}
              </div>
            </div>
          )}

          {messages.map((msg,i)=>(
            <div key={i} style={{ display:"flex", gap:10, flexDirection:msg.type==="user"?"row-reverse":"row", alignItems:"flex-start" }}>
              <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:msg.type==="agent"?15:13, background:msg.type==="agent"?"#eaf3ee":"#f0ede6", color:msg.type==="agent"?"#2d5a3d":"#6b6560", border:"1px solid #e2ddd5", fontFamily:"Georgia,serif", marginTop:1 }}>
                {msg.type==="agent"?"M":msg.type==="error"?"⚠":"👤"}
              </div>
              <div style={{ maxWidth:"78%" }}>
                {msg.meta&&<div style={{ fontSize:10, color:"#a09a93", marginBottom:4 }}>{msg.meta}</div>}
                <div style={{ padding:"12px 16px", borderRadius:14, background:msg.type==="user"?"#2d5a3d":msg.type==="error"?"#fceaea":"#fff", color:msg.type==="user"?"#fff":msg.type==="error"?"#8b2020":"#1c1917", border:msg.type==="user"?"none":`1px solid ${msg.type==="error"?"#f09595":"#e2ddd5"}`, borderTopLeftRadius:msg.type!=="user"?4:14, borderTopRightRadius:msg.type==="user"?4:14 }}>
                  {msg.type==="user"?<span style={{ fontSize:13 }}>{msg.text}</span>:msg.type==="error"?<span style={{ fontSize:13 }}>Erreur : {msg.text}</span>:parseContent(msg.text)}
                </div>
                {msg.type==="agent"&&(
                  <div style={{ display:"flex", justifyContent:"flex-end", gap:6, marginTop:5 }}>
                    <button onClick={()=>downloadAsPdf(msg.text, msg.text.split("\n")[0].replace(/[#*📚▶️📸👥💬🔗🐦🔬📄📋]/g,"").trim().slice(0,40))} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", border:"1px solid #e2ddd5", borderRadius:20, background:"#fff", cursor:"pointer", fontSize:11, color:"#6b6560", fontFamily:"system-ui,sans-serif" }} onMouseEnter={e=>{e.currentTarget.style.background="#f5f3ee";}} onMouseLeave={e=>{e.currentTarget.style.background="#fff";}}>
                      ⬇️ PDF
                    </button>
                    <button onClick={()=>setSaveTarget(msg)} style={{ display:"flex", alignItems:"center", gap:5, padding:"4px 10px", border:"1px solid #e2ddd5", borderRadius:20, background:"#fff", cursor:"pointer", fontSize:11, color:"#6b6560", fontFamily:"system-ui,sans-serif" }} onMouseEnter={e=>{e.currentTarget.style.background="#eaf3ee";e.currentTarget.style.color="#2d5a3d";e.currentTarget.style.borderColor="#a8cdb5";}} onMouseLeave={e=>{e.currentTarget.style.background="#fff";e.currentTarget.style.color="#6b6560";e.currentTarget.style.borderColor="#e2ddd5";}}>
                      🔖 Sauvegarder
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading&&<div style={{ display:"flex", gap:10, alignItems:"flex-start" }}><div style={{ width:32, height:32, borderRadius:"50%", background:"#eaf3ee", color:"#2d5a3d", border:"1px solid #e2ddd5", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Georgia,serif", fontSize:15, flexShrink:0 }}>M</div><div><div style={{ display:"flex", gap:5, padding:"12px 16px", background:"#fff", border:"1px solid #e2ddd5", borderRadius:14, borderTopLeftRadius:4, width:"fit-content" }}>{[0,220,440].map((d,i)=><div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"#a09a93", animation:`blink 1.3s ${d}ms infinite` }} />)}</div><div style={{ fontSize:11, color:"#a09a93", marginTop:4, display:"flex", alignItems:"center", gap:5 }}><div style={{ width:6, height:6, borderRadius:"50%", background:"#2d5a3d", animation:"pulse 1.5s infinite" }} />Recherche en cours…</div></div></div>}
          <div style={{ height:10 }} />
        </div>

        <div style={{ padding:"14px 24px 18px", background:"#fff", borderTop:"1px solid #e2ddd5" }}>
          <div style={{ display:"flex", gap:8, background:"#f0ede6", border:"1px solid #cec9bf", borderRadius:14, padding:"6px 6px 6px 16px" }}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(input);}}} placeholder="Ex : ressources TDAH adulte, livres dépression Fnac, recommandations HAS 2024..." disabled={loading} style={{ flex:1, border:"none", background:"none", fontSize:13, color:"#1c1917", outline:"none", fontFamily:"system-ui,sans-serif" }} />
            <button onClick={()=>setAnalyseOpen(true)} title="Analyser PDFs et liens" style={{ padding:"8px 10px", background:"#f0ede6", border:"1px solid #cec9bf", borderRadius:10, fontSize:16, cursor:"pointer", flexShrink:0, color:"#6b6560" }}>📎</button>
            <button onClick={()=>sendMessage(input)} disabled={loading||!input.trim()} style={{ padding:"8px 18px", background:loading||!input.trim()?"#cec9bf":"#2d5a3d", color:"#fff", border:"none", borderRadius:10, fontSize:13, cursor:loading||!input.trim()?"not-allowed":"pointer", fontWeight:500, fontFamily:"system-ui,sans-serif", flexShrink:0 }}>{loading?"…":"Envoyer →"}</button>
          </div>
          <div style={{ fontSize:11, color:"#a09a93", marginTop:7, textAlign:"center" }}>HAS · ANSM · Inserm · OMS · PubMed · YouTube · Instagram · Facebook · Reddit · Amazon.fr · Fnac</div>
        </div>
      </div>
      <style>{`@keyframes blink{0%,60%,100%{opacity:0.3;transform:scale(0.85)}30%{opacity:1;transform:scale(1)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}*::-webkit-scrollbar{width:4px}*::-webkit-scrollbar-thumb{background:#cec9bf;border-radius:2px}`}</style>
    </div>
  );
}
