import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Play,
  Pause,
  RotateCcw,
  Plus,
  Minus,
  CheckCircle2,
  Sparkles,
  Copy,
  Check,
  Printer,
  Save,
  Trash2,
  Clock,
  Users,
  TrendingUp,
  FileText,
  Zap,
  Award,
  AlertTriangle,
  History,
  X,
} from 'lucide-react';

interface RoleTier {
  id: string;
  labelSv: string;
  rateSekPerHour: number;
  count: number;
}

type ItemKind = 'action' | 'decision' | 'blocker';

interface ExtractedItem {
  id: string;
  kind: ItemKind;
  text: string;
  owner: string;
  due: string;
  done: boolean;
}

interface AgendaStep {
  id: string;
  title: string;
  minutes: number;
  completed: boolean;
}

interface SavedMeeting {
  id: string;
  title: string;
  totalCostSek: number;
  durationSeconds: number;
  attendeeCount: number;
  decisionsCount: number;
  actionsCount: number;
  items: ExtractedItem[];
  createdAt: string;
}

const DEFAULT_ROLES: RoleTier[] = [
  { id: 'dev', labelSv: 'Utvecklare / Engineer', rateSekPerHour: 1150, count: 3 },
  { id: 'lead', labelSv: 'Tech Lead / Principal', rateSekPerHour: 1450, count: 1 },
  { id: 'pm', labelSv: 'Produktchef / PM', rateSekPerHour: 1250, count: 1 },
  { id: 'ux', labelSv: 'UX / Designer', rateSekPerHour: 1100, count: 0 },
  { id: 'exec', labelSv: 'Kund / Beställare / VP', rateSekPerHour: 1650, count: 0 },
];

const DEFAULT_AGENDA: AgendaStep[] = [
  { id: 'a1', title: 'Kontext & Mål med mötet', minutes: 5, completed: false },
  { id: 'a2', title: 'Kärndiskussion & Vägval', minutes: 15, completed: false },
  { id: 'a3', title: 'Beslut, @Ansvariga & Nästa steg', minutes: 10, completed: false },
];

let sharedAudioCtx: AudioContext | null = null;

function playTickChime(freq = 660) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {}
}

export function App() {
  const [meetingTitle, setMeetingTitle] = useState('Arkitektur & Sprint-Beslut');
  const [plannedMinutes, setPlannedMinutes] = useState(30);
  const [includePayrollTax, setIncludePayrollTax] = useState(false);
  const [roles, setRoles] = useState<RoleTier[]>(DEFAULT_ROLES);

  // Live Timer State
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Agenda State
  const [agenda, setAgenda] = useState<AgendaStep[]>(DEFAULT_AGENDA);
  const [newAgendaTitle, setNewAgendaTitle] = useState('');
  const [newAgendaMins, setNewAgendaMins] = useState(10);

  // Action & Decision Extractor State
  const [items, setItems] = useState<ExtractedItem[]>([
    {
      id: 'init-1',
      kind: 'decision',
      text: 'Kör SQLite med WAL-läge för lokal persistens utan externa beroenden',
      owner: 'Viktor',
      due: 'Idag',
      done: false,
    },
    {
      id: 'init-2',
      kind: 'action',
      text: 'Verifiera /health och JS-bundle status i CI/CD-pipelinen',
      owner: 'Minihark',
      due: 'Fredag',
      done: false,
    },
  ]);
  const [newItemKind, setNewItemKind] = useState<ItemKind>('action');
  const [newItemText, setNewItemText] = useState('');
  const [newItemOwner, setNewItemOwner] = useState('');
  const [newItemDue, setNewItemDue] = useState('Denna vecka');
  const [rawNotes, setRawNotes] = useState('');
  const [showRawParser, setShowRawParser] = useState(false);

  // Export & Persistence State
  const [exportFormat, setExportFormat] = useState<'slack' | 'markdown'>('slack');
  const [copiedMode, setCopiedMode] = useState<string | null>(null);
  const [savedMeetings, setSavedMeetings] = useState<SavedMeeting[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isProModalOpen, setIsProModalOpen] = useState(false);

  const lastTickRef = useRef<number | null>(null);

  // Load saved meetings from SQLite backend
  useEffect(() => {
    fetch('/api/meetings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.meetings)) {
          setSavedMeetings(data.meetings);
        }
      })
      .catch(() => {});
  }, []);

  // Stopwatch loop (100ms resolution for smooth odometer)
  useEffect(() => {
    if (!isRunning) {
      lastTickRef.current = null;
      return;
    }
    lastTickRef.current = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - (lastTickRef.current || now)) / 1000;
      lastTickRef.current = now;
      setElapsedSeconds((prev) => prev + dt);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Cost Calculations
  const taxMultiplier = includePayrollTax ? 1.3142 : 1.0;
  const totalAttendees = roles.reduce((sum, r) => sum + r.count, 0);
  const burnRatePerHourSek =
    roles.reduce((sum, r) => sum + r.count * r.rateSekPerHour, 0) * taxMultiplier;
  const burnRatePerMinSek = burnRatePerHourSek / 60;
  const burnRatePerSecSek = burnRatePerHourSek / 3600;

  const liveCostSek = elapsedSeconds * burnRatePerSecSek;
  const plannedTotalCostSek = (plannedMinutes / 60) * burnRatePerHourSek;

  const decisionsCount = items.filter((i) => i.kind === 'decision').length;
  const actionsCount = items.filter((i) => i.kind === 'action').length;
  const totalOutcomes = decisionsCount + actionsCount;
  const referenceCost = elapsedSeconds > 10 ? liveCostSek : plannedTotalCostSek;
  const costPerOutcomeSek =
    totalOutcomes > 0 ? Math.round(referenceCost / totalOutcomes) : Math.round(referenceCost);

  // Efficiency Grade
  const getEfficiencyGrade = () => {
    if (totalOutcomes >= 4 && costPerOutcomeSek <= 900) {
      return { grade: 'A+', label: 'Högoktanigt beslutsmöte', color: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' };
    }
    if (totalOutcomes >= 2) {
      return { grade: 'B+', label: 'Konstruktivt & målfokuserat', color: 'text-amber-300 border-amber-400/40 bg-amber-500/10' };
    }
    return { grade: 'C', label: 'Fånga fler konkreta beslut/actions', color: 'text-rose-300 border-rose-400/40 bg-rose-500/10' };
  };
  const efficiency = getEfficiencyGrade();

  const formatDuration = (secs: number) => {
    const total = Math.floor(secs);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const remSecs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;
  };

  const applyPreset = (
    title: string,
    mins: number,
    counts: Record<string, number>
  ) => {
    playTickChime(740);
    setMeetingTitle(title);
    setPlannedMinutes(mins);
    setRoles((prev) =>
      prev.map((r) => ({ ...r, count: counts[r.id] ?? 0 }))
    );
  };

  const updateRoleCount = (id: string, delta: number) => {
    playTickChime(580);
    setRoles((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, count: Math.max(0, r.count + delta) } : r
      )
    );
  };

  const updateRoleRate = (id: string, rate: number) => {
    setRoles((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, rateSekPerHour: Math.max(0, rate) } : r
      )
    );
  };

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    playTickChime(820);
    const item: ExtractedItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: newItemKind,
      text: newItemText.trim(),
      owner: newItemOwner.trim() || 'Teamet',
      due: newItemDue.trim() || 'Snarast',
      done: false,
    };
    setItems((prev) => [...prev, item]);
    setNewItemText('');
    setNewItemOwner('');
  };

  const handleExtractFromRawNotes = () => {
    if (!rawNotes.trim()) return;
    const lines = rawNotes
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const extracted: ExtractedItem[] = [];
    lines.forEach((line, idx) => {
      const cleaned = line.replace(/^[-*•]\s*(\[.\]\s*)?/, '').trim();
      if (!cleaned) return;

      let kind: ItemKind = 'action';
      let body = cleaned;

      if (/^(beslut|decision|val):/i.test(cleaned)) {
        kind = 'decision';
        body = cleaned.replace(/^(beslut|decision|val):\s*/i, '');
      } else if (/^(risk|blocker|hinder):/i.test(cleaned)) {
        kind = 'blocker';
        body = cleaned.replace(/^(risk|blocker|hinder):\s*/i, '');
      } else if (/^(todo|action|att göra|nästa steg):/i.test(cleaned)) {
        kind = 'action';
        body = cleaned.replace(/^(todo|action|att göra|nästa steg):\s*/i, '');
      }

      const ownerMatch = body.match(/@([A-Za-zÅÄÖåäö0-9_-]+)/);
      const owner = ownerMatch ? ownerMatch[1] : 'Teamet';
      const dueMatch = body.match(/\b(idag|imorgon|måndag|tisdag|onsdag|torsdag|fredag|\d{4}-\d{2}-\d{2})\b/i);
      const due = dueMatch ? dueMatch[1] : 'Denna vecka';

      extracted.push({
        id: `parsed-${Date.now()}-${idx}`,
        kind,
        text: body,
        owner,
        due,
        done: false,
      });
    });

    if (extracted.length > 0) {
      playTickChime(880);
      setItems((prev) => [...prev, ...extracted]);
      setRawNotes('');
      setShowRawParser(false);
    }
  };

  const buildExportString = (mode: 'slack' | 'markdown') => {
    const dateStr = new Date().toLocaleDateString('sv-SE');
    const activeCost = Math.round(elapsedSeconds > 10 ? liveCostSek : plannedTotalCostSek);
    const durLabel =
      elapsedSeconds > 10
        ? `${formatDuration(elapsedSeconds)} (planerat ${plannedMinutes} min)`
        : `${plannedMinutes} min (uppskattat)`;

    const decisions = items.filter((i) => i.kind === 'decision');
    const actions = items.filter((i) => i.kind === 'action');
    const blockers = items.filter((i) => i.kind === 'blocker');

    if (mode === 'slack') {
      return [
        `⏱️ *MÖTESKOLL SAMMANFATTNING: ${meetingTitle}* (${dateStr})`,
        `👥 *Deltagare:* ${totalAttendees} pers • ⏳ *Tid:* ${durLabel}`,
        `💰 *Mötesinvestering:* ${activeCost.toLocaleString('sv-SE')} kr (${Math.round(burnRatePerMinSek)} kr/min) • 🎯 *Snitt per beslut/action:* ${costPerOutcomeSek.toLocaleString('sv-SE')} kr`,
        '',
        decisions.length > 0
          ? `✅ *BESLUT (${decisions.length}):*\n` +
            decisions.map((d) => `• ${d.text} _(${d.owner})_`).join('\n')
          : null,
        actions.length > 0
          ? `🚀 *ACTION ITEMS (${actions.length}):*\n` +
            actions
              .map((a) => `• [ ] *${a.owner}:* ${a.text} _(Deadline: ${a.due})_`)
              .join('\n')
          : null,
        blockers.length > 0
          ? `⚠️ *RISKER / BLOCKERS (${blockers.length}):*\n` +
            blockers.map((b) => `• ${b.text} _(${b.owner})_`).join('\n')
          : null,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return [
      `# Mötesprotokoll & ROI: ${meetingTitle}`,
      `- **Datum:** ${dateStr}`,
      `- **Deltagare:** ${totalAttendees} personer (${Math.round(burnRatePerHourSek).toLocaleString('sv-SE')} kr/h)`,
      `- **Tidsåtgång:** ${durLabel}`,
      `- **Möteskostnad:** **${activeCost.toLocaleString('sv-SE')} SEK** (${costPerOutcomeSek.toLocaleString('sv-SE')} SEK per beslut/action)`,
      '',
      `## ✅ Fattade Beslut (${decisions.length})`,
      ...(decisions.length > 0
        ? decisions.map((d) => `- **${d.text}** *(Ansvarig: @${d.owner})*`)
        : ['_Inga registrerade beslut._']),
      '',
      `## 🎯 Action Items (${actions.length})`,
      ...(actions.length > 0
        ? actions.map(
            (a) => `- [ ] **@${a.owner}**: ${a.text} *(Deadline: ${a.due})*`
          )
        : ['_Inga registrerade action items._']),
      ...(blockers.length > 0
        ? [
            '',
            `## ⚠️ Risker & Blockers (${blockers.length})`,
            ...blockers.map((b) => `- ⚠️ **${b.text}** *(@${b.owner})*`),
          ]
        : []),
    ].join('\n');
  };

  const handleCopyExport = async (mode: 'slack' | 'markdown') => {
    const text = buildExportString(mode);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMode(mode);
      playTickChime(880);
      setTimeout(() => setCopiedMode(null), 2200);
    } catch {}
  };

  const handleSaveMeeting = async () => {
    setIsSaving(true);
    playTickChime(780);
    const activeCost = Math.round(elapsedSeconds > 10 ? liveCostSek : plannedTotalCostSek);
    const payload: SavedMeeting = {
      id: `mtg-${Date.now()}`,
      title: meetingTitle.trim() || 'Namnlöst möte',
      totalCostSek: activeCost,
      durationSeconds: Math.round(elapsedSeconds > 10 ? elapsedSeconds : plannedMinutes * 60),
      attendeeCount: totalAttendees,
      decisionsCount,
      actionsCount,
      items,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSavedMeetings((prev) => [payload, ...prev]);
        try {
          confetti({ particleCount: 45, spread: 60, origin: { y: 0.65 } });
        } catch {}
      }
    } catch {}
    setIsSaving(false);
  };

  const handleDeleteSavedMeeting = async (id: string) => {
    try {
      await fetch(`/api/meetings?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setSavedMeetings((prev) => prev.filter((m) => m.id !== id));
    } catch {}
  };

  const progressPct = Math.min(
    100,
    Math.round((elapsedSeconds / Math.max(60, plannedMinutes * 60)) * 100)
  );

  return (
    <div className="min-h-screen bg-[#060911] text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#060911]/90 backdrop-blur-md print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-amber-500/20">
              ⏱️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-lg tracking-tight text-white">
                  MötesKoll
                </span>
                <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  SEK Cost-Ticker & Action Studio
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Realtidskalkylator för möteskostnad, tidbox-puls & 1-klicks Slack/Markdown-protokoll
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer transition"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Mötes-Kvitto (PDF)</span>
            </button>

            <button
              onClick={() => setIsProModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:brightness-110 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer transition"
            >
              <Award className="w-3.5 h-3.5" />
              <span>Team Pro</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 print:hidden">
        {/* Preset Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/70 border border-slate-800/90 rounded-2xl p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Snabbmallar:</span>
            </span>
            <button
              onClick={() =>
                applyPreset('Daily Standup & Blockers', 15, {
                  dev: 4,
                  lead: 1,
                  pm: 1,
                  ux: 0,
                  exec: 0,
                })
              }
              className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 cursor-pointer transition"
            >
              ⚡ Standup (6 pers, 15m)
            </button>
            <button
              onClick={() =>
                applyPreset('Arkitektur & Systemdesign', 45, {
                  dev: 2,
                  lead: 2,
                  pm: 0,
                  ux: 0,
                  exec: 0,
                })
              }
              className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 cursor-pointer transition"
            >
              🏗️ Arkitektur-Review (4 pers, 45m)
            </button>
            <button
              onClick={() =>
                applyPreset('Sprint-Planering & Prioritering', 60, {
                  dev: 5,
                  lead: 1,
                  pm: 1,
                  ux: 1,
                  exec: 0,
                })
              }
              className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 cursor-pointer transition"
            >
              🎯 Sprint-Planering (8 pers, 60m)
            </button>
            <button
              onClick={() =>
                applyPreset('Kund-Steering & Leveransstatus', 45, {
                  dev: 1,
                  lead: 1,
                  pm: 1,
                  ux: 0,
                  exec: 2,
                })
              }
              className="px-2.5 py-1 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-200 cursor-pointer transition"
            >
              💼 Kund-Steering (5 pers, 45m)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="Mötestitel..."
              className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-xs sm:text-sm font-bold text-white focus:outline-none focus:border-amber-400 w-56 sm:w-64"
            />
          </div>
        </div>

        {/* HERO LIVE COST-TICKER ODOMETER */}
        <div className="relative rounded-3xl bg-gradient-to-br from-slate-900 via-[#0b1222] to-slate-950 border-2 border-amber-500/30 p-6 sm:p-8 shadow-2xl overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            {/* Odometer Column */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-black uppercase tracking-wider">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isRunning ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'
                    }`}
                  />
                  {isRunning ? 'LIVE MÖTES-TAXAMETER AKTIV' : 'REDO ATT STARTA TIDBOX'}
                </span>
                <span className={`px-3 py-1 rounded-full border text-xs font-bold ${efficiency.color}`}>
                  ROI-Betyg: {efficiency.grade} • {efficiency.label}
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-4">
                <div className="font-mono text-5xl sm:text-7xl font-black tracking-tight text-white">
                  {liveCostSek.toLocaleString('sv-SE', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  <span className="text-2xl sm:text-3xl text-amber-400 ml-2">
                    kr
                  </span>
                </div>
                <div className="font-mono text-xl sm:text-2xl font-bold text-slate-400">
                  ({formatDuration(elapsedSeconds)})
                </div>
              </div>

              {/* Timebox Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>
                    Bränntakt:{' '}
                    <strong className="text-amber-300">
                      {Math.round(burnRatePerMinSek)} kr/min
                    </strong>{' '}
                    ({Math.round(burnRatePerHourSek).toLocaleString('sv-SE')} kr/h)
                  </span>
                  <span>
                    Planerad budget ({plannedMinutes} min):{' '}
                    <strong className="text-white">
                      {Math.round(plannedTotalCostSek).toLocaleString('sv-SE')} kr
                    </strong>
                  </span>
                </div>
                <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      progressPct >= 100
                        ? 'bg-gradient-to-r from-rose-500 to-red-600'
                        : 'bg-gradient-to-r from-emerald-400 via-amber-400 to-orange-500'
                    }`}
                    style={{ width: `${Math.max(2, progressPct)}%` }}
                  />
                </div>
              </div>

              {/* Timer Controls */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={() => {
                    playTickChime(isRunning ? 520 : 880);
                    setIsRunning(!isRunning);
                  }}
                  className={`px-6 py-3 rounded-2xl font-black text-sm flex items-center gap-2 shadow-lg cursor-pointer transition ${
                    isRunning
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                      : 'bg-emerald-400 hover:bg-emerald-300 text-slate-950'
                  }`}
                >
                  {isRunning ? (
                    <>
                      <Pause className="w-4 h-4 fill-slate-950" />
                      <span>Pausa taxameter</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-slate-950" />
                      <span>Starta mötestimer</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    playTickChime(640);
                    setElapsedSeconds((prev) => prev + 300);
                  }}
                  className="px-3.5 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono font-bold text-slate-200 cursor-pointer transition"
                  title="Simulera +5 minuter"
                >
                  +5 min
                </button>

                <button
                  onClick={() => {
                    playTickChime(440);
                    setIsRunning(false);
                    setElapsedSeconds(0);
                  }}
                  className="px-3.5 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Nollställ</span>
                </button>
              </div>
            </div>

            {/* Right Metrics Grid */}
            <div className="lg:col-span-5 grid grid-cols-2 gap-3">
              <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1">
                <div className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Deltagare i rummet</span>
                </div>
                <div className="text-2xl font-black font-mono text-white">
                  {totalAttendees} pers
                </div>
                <div className="text-[11px] text-slate-500">
                  Snitt {totalAttendees > 0 ? Math.round(burnRatePerHourSek / totalAttendees) : 0} kr/h per person
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1">
                <div className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                  <span>Kostnad / Beslut</span>
                </div>
                <div className="text-2xl font-black font-mono text-amber-400">
                  {costPerOutcomeSek.toLocaleString('sv-SE')} kr
                </div>
                <div className="text-[11px] text-slate-500">
                  {decisionsCount} beslut • {actionsCount} actions
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1">
                <div className="text-[11px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Tidbox-längd</span>
                </div>
                <div className="flex items-center gap-1.5 pt-0.5">
                  {[15, 30, 45, 60].map((m) => (
                    <button
                      key={m}
                      onClick={() => setPlannedMinutes(m)}
                      className={`px-2 py-1 rounded-lg font-mono text-xs font-bold cursor-pointer transition ${
                        plannedMinutes === m
                          ? 'bg-amber-400 text-slate-950 font-black'
                          : 'bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-1">
                <div className="text-[11px] font-bold uppercase text-slate-400">
                  Motsvarar i värde
                </div>
                <div className="text-base font-black font-mono text-cyan-300">
                  ☕ {Math.max(1, Math.round(referenceCost / 52))} st fika
                </div>
                <div className="text-[11px] text-slate-500">
                  eller {(referenceCost / 1150).toFixed(1)}h oavbruten kodtid
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TWO-COLUMN WORKSPACE: LEFT = ROLES & AGENDA, RIGHT = ACTION EXTRACTOR & EXPORT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Participants & Agenda Pacer */}
          <div className="lg:col-span-5 space-y-6">
            {/* Participant Roles Calculator */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  <span>Deltagare & Timarvoden</span>
                </h2>
                <button
                  onClick={() => setIncludePayrollTax(!includePayrollTax)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border cursor-pointer transition ${
                    includePayrollTax
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {includePayrollTax ? '✓ +31.42% Arb.avgift' : '+31.42% Arb.avgift'}
                </button>
              </div>

              <div className="space-y-2.5">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    className={`p-3 rounded-2xl border flex items-center justify-between gap-2 transition ${
                      r.count > 0
                        ? 'bg-slate-950 border-slate-700'
                        : 'bg-slate-950/40 border-slate-800/60 opacity-75'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">
                        {r.labelSv}
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          value={r.rateSekPerHour}
                          onChange={(e) =>
                            updateRoleRate(r.id, Number(e.target.value))
                          }
                          className="w-20 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-xs text-amber-300"
                        />
                        <span className="text-[11px] text-slate-400 font-mono">
                          kr/h
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateRoleCount(r.id, -1)}
                        className="w-8 h-8 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-6 text-center font-mono font-black text-base text-white">
                        {r.count}
                      </span>
                      <button
                        onClick={() => updateRoleCount(r.id, 1)}
                        className="w-8 h-8 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 flex items-center justify-center text-amber-300 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agenda Timebox Pacer */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>Agenda & Tidbox-Pacer</span>
                </h2>
                <span className="text-xs font-mono text-slate-400">
                  Totalt {agenda.reduce((s, a) => s + a.minutes, 0)} min
                </span>
              </div>

              <div className="space-y-2">
                {agenda.map((step, idx) => {
                  const stepCost = Math.round(step.minutes * burnRatePerMinSek);
                  return (
                    <div
                      key={step.id}
                      onClick={() => {
                        playTickChime(700);
                        setAgenda((prev) =>
                          prev.map((a) =>
                            a.id === step.id
                              ? { ...a, completed: !a.completed }
                              : a
                          )
                        );
                      }}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                        step.completed
                          ? 'bg-emerald-950/20 border-emerald-500/30 text-slate-400 line-through'
                          : 'bg-slate-950 border-slate-800 hover:border-cyan-500/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CheckCircle2
                          className={`w-4 h-4 flex-shrink-0 ${
                            step.completed ? 'text-emerald-400' : 'text-slate-600'
                          }`}
                        />
                        <span className="text-xs font-bold truncate">
                          {idx + 1}. {step.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 font-mono text-xs">
                        <span className="text-cyan-300 font-bold">
                          {step.minutes}m
                        </span>
                        <span className="text-slate-500">({stepCost} kr)</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newAgendaTitle.trim()) return;
                  setAgenda((prev) => [
                    ...prev,
                    {
                      id: `ag-${Date.now()}`,
                      title: newAgendaTitle.trim(),
                      minutes: newAgendaMins,
                      completed: false,
                    },
                  ]);
                  setNewAgendaTitle('');
                }}
                className="flex gap-2 pt-1"
              >
                <input
                  type="text"
                  value={newAgendaTitle}
                  onChange={(e) => setNewAgendaTitle(e.target.value)}
                  placeholder="Ny agendapunkt..."
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                />
                <input
                  type="number"
                  value={newAgendaMins}
                  onChange={(e) => setNewAgendaMins(Number(e.target.value))}
                  className="w-16 px-2 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-center text-cyan-300"
                />
                <button
                  type="submit"
                  className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 text-xs font-bold cursor-pointer"
                >
                  + Punkt
                </button>
              </form>
            </div>
          </div>

          {/* Right Column: Action Extractor & 1-Click Slack/Markdown Exporter */}
          <div className="lg:col-span-7 space-y-6">
            {/* Action-Item & Decision Studio */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    <span>Beslut & Action-Item Extraktor</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Logga beslut och @ansvariga direkt — eller klistra in råa mötesanteckningar
                  </p>
                </div>

                <button
                  onClick={() => setShowRawParser(!showRawParser)}
                  className="px-3 py-1.5 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>
                    {showRawParser
                      ? 'Dölj råtext-tolk'
                      : '⚡ Extrahera ur råa anteckningar'}
                  </span>
                </button>
              </div>

              {/* Smart Raw Notes Parser Drawer */}
              {showRawParser && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-amber-400/40 space-y-3">
                  <div className="text-xs font-bold text-amber-200">
                    Klistra in råa anteckningar (stöder <code className="text-cyan-300">BESLUT:</code>,{' '}
                    <code className="text-cyan-300">TODO:</code>,{' '}
                    <code className="text-cyan-300">RISK:</code>,{' '}
                    <code className="text-cyan-300">@namn</code> och veckodagar):
                  </div>
                  <textarea
                    value={rawNotes}
                    onChange={(e) => setRawNotes(e.target.value)}
                    rows={4}
                    placeholder={`Exempel:\nBESLUT: Vi kör Stripe + Swish direkt utan tredjeparts-annonser @Viktor\nTODO: @Erik sätt upp SQLite-backuper innan fredag\nRISK: Tredjeparts-API har rate-limit vid hög last @Anna`}
                    className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleExtractFromRawNotes}
                      className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs cursor-pointer"
                    >
                      ✨ Extrahera Beslut & Actions nu
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Add Form */}
              <form
                onSubmit={handleAddItem}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2"
              >
                <select
                  value={newItemKind}
                  onChange={(e) => setNewItemKind(e.target.value as ItemKind)}
                  className="sm:col-span-3 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-bold text-white"
                >
                  <option value="action">🎯 Action-Item</option>
                  <option value="decision">✅ Beslut</option>
                  <option value="blocker">⚠️ Risk / Blocker</option>
                </select>
                <input
                  type="text"
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  placeholder="Vad ska göras eller vad beslutades?"
                  className="sm:col-span-5 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-400"
                />
                <input
                  type="text"
                  value={newItemOwner}
                  onChange={(e) => setNewItemOwner(e.target.value)}
                  placeholder="@Ansvarig"
                  className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 px-3 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs cursor-pointer transition"
                >
                  + Lägg till
                </button>
              </form>

              {/* Captured Items List */}
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase flex-shrink-0 ${
                          item.kind === 'decision'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : item.kind === 'blocker'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {item.kind === 'decision'
                          ? '✅ Beslut'
                          : item.kind === 'blocker'
                          ? '⚠️ Risk'
                          : '🎯 Action'}
                      </span>
                      <span className="text-xs sm:text-sm font-semibold text-white truncate">
                        {item.text}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-cyan-300">
                        @{item.owner}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                        {item.due}
                      </span>
                      <button
                        onClick={() =>
                          setItems((prev) =>
                            prev.filter((i) => i.id !== item.id)
                          )
                        }
                        className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Instant Slack & Markdown Exporter + Save to SQLite */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExportFormat('slack')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer transition ${
                      exportFormat === 'slack'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    💬 Slack / Teams-format
                  </button>
                  <button
                    onClick={() => setExportFormat('markdown')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer transition ${
                      exportFormat === 'markdown'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-slate-950 text-slate-400 hover:text-white'
                    }`}
                  >
                    📝 Markdown (Notion / GitHub)
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleCopyExport(exportFormat)}
                    className="px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition"
                  >
                    {copiedMode === exportFormat ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Kopierat!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>
                          Kopiera{' '}
                          {exportFormat === 'slack' ? 'Slack-text' : 'Markdown'}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleSaveMeeting}
                    disabled={isSaving}
                    className="px-4 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition"
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {isSaving ? 'Sparar...' : 'Spara möte (SQLite)'}
                    </span>
                  </button>
                </div>
              </div>

              <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 whitespace-pre-wrap overflow-x-auto leading-relaxed">
                {buildExportString(exportFormat)}
              </pre>
            </div>
          </div>
        </div>

        {/* Saved Meetings History (SQLite Persisted) */}
        {savedMeetings.length > 0 && (
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <History className="w-4 h-4" />
                <span>Sparade Mötes-Kvitton i Databasen ({savedMeetings.length})</span>
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedMeetings.map((m) => (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-sm text-white truncate">
                        {m.title}
                      </h4>
                      <button
                        onClick={() => handleDeleteSavedMeeting(m.id)}
                        className="text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-xs font-mono text-slate-400 mt-1">
                      {new Date(m.createdAt).toLocaleDateString('sv-SE')} •{' '}
                      {m.attendeeCount} delt • {Math.round(m.durationSeconds / 60)} min
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
                    <span className="font-black text-amber-400 text-sm">
                      {Math.round(m.totalCostSek).toLocaleString('sv-SE')} kr
                    </span>
                    <span className="text-emerald-300">
                      ✅ {m.decisionsCount} beslut • 🎯 {m.actionsCount} actions
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* PRINTABLE MEETING ROI RECEIPT */}
      <div
        id="moteskoll-printable-receipt"
        className="hidden print:block p-8 bg-white text-slate-900 space-y-6"
      >
        <div className="border-b-2 border-slate-900 pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase">
              MÖTESKOLL — MÖTESKVITTO & BESLUTSPROTOKOLL
            </h1>
            <p className="text-sm font-bold text-slate-600">{meetingTitle}</p>
          </div>
          <div className="text-right font-mono text-sm">
            <div>Datum: {new Date().toLocaleDateString('sv-SE')}</div>
            <div>Deltagare: {totalAttendees} personer</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 font-mono border-b border-slate-300 pb-4">
          <div>
            <div className="text-xs uppercase text-slate-500">Möteskostnad</div>
            <div className="text-xl font-black">
              {Math.round(referenceCost).toLocaleString('sv-SE')} SEK
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">
              Kostnad per Beslut/Action
            </div>
            <div className="text-xl font-black">
              {costPerOutcomeSek.toLocaleString('sv-SE')} SEK
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-500">ROI-Betyg</div>
            <div className="text-xl font-black">{efficiency.grade}</div>
          </div>
        </div>

        <pre className="text-xs font-mono whitespace-pre-wrap">
          {buildExportString('markdown')}
        </pre>
      </div>

      {/* PRO UNLOCK MODAL (Direct Value Exchange, Zero Ads) */}
      {isProModalOpen && (
        <div
          onClick={() => setIsProModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full bg-slate-900 border border-amber-400/40 rounded-3xl p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-400 font-black text-base">
                <Award className="w-5 h-5" />
                <span>MötesKoll Team Pro — 149 kr</span>
              </div>
              <button
                onClick={() => setIsProModalOpen(false)}
                className="p-1.5 rounded-xl bg-slate-950 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-300">
              Byggd enligt Harkco-principerna: <strong>100% fri från annonser och spårning</strong>. Engångsupplåsning för konsultbolag och tech-leads:
            </p>
            <ul className="space-y-2 text-xs text-slate-200">
              <li>✅ Obegränsad SQLite-historik & kvartalsvis mötes-ROI-rapport</li>
              <li>✅ Direkt Webhook-export till Slack, Linear & Jira</li>
              <li>✅ Anpassade konsultprislistor & kund-faktureringsunderlag (CSV/PDF)</li>
            </ul>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setIsProModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 font-black text-xs cursor-pointer"
              >
                Stäng förhandsvisning
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-slate-900 py-5 text-center text-xs text-slate-500 print:hidden">
        MötesKoll — Harkco Daily Apps • Noll annonser • Hög mötesdisciplin
      </footer>
    </div>
  );
}

export default App;
