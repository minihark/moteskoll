import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Play,
  Pause,
  RotateCcw,
  Plus,
  Minus,
  CheckCircle2,
  Circle,
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
  Bell,
  BellOff,
  Calendar,
  Upload,
  ChevronDown,
  SlidersHorizontal,
  Coffee,
  CheckSquare,
  Square,
  Sparkles,
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
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
  } catch {}
}

function playThresholdAlertChime(level: 'warning' | 'critical') {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    const ctx = sharedAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const notes = level === 'critical' ? [587.33, 783.99, 1046.5] : [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const start = ctx.currentTime + idx * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = level === 'critical' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.08, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  } catch {}
}

function parseIcsTimestamp(raw: string): Date | null {
  const m = raw.trim().match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  return new Date(+y, +mo - 1, +d, +h, +mi, +s);
}

export function App() {
  const [meetingTitle, setMeetingTitle] = useState('Arkitektur & Sprint-Beslut');
  const [plannedMinutes, setPlannedMinutes] = useState(30);
  const [includePayrollTax, setIncludePayrollTax] = useState(false);
  const [roles, setRoles] = useState<RoleTier[]>(DEFAULT_ROLES);

  // Live Timer State
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Cost-Alert Threshold State
  const [budgetLimitSek, setBudgetLimitSek] = useState<number>(5000);
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState<boolean>(true);
  const firedThresholdStageRef = useRef<0 | 1 | 2>(0);

  // Drawer / Modal Visibility
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isAgendaOpen, setIsAgendaOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isProModalOpen, setIsProModalOpen] = useState(false);

  // Agenda & Calendar (.ics) Importer State
  const [agenda, setAgenda] = useState<AgendaStep[]>(DEFAULT_AGENDA);
  const [newAgendaTitle, setNewAgendaTitle] = useState('');
  const [newAgendaMins, setNewAgendaMins] = useState(10);
  const [calendarInputText, setCalendarInputText] = useState('');
  const [calendarImportNotice, setCalendarImportNotice] = useState<string | null>(null);

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
      text: 'Verifiera /health och JS-bundle status i Coolify-pipelinen',
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

  // Stopwatch loop (100ms resolution for smooth Braun odometer)
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

  const budgetRatio = budgetLimitSek > 0 ? liveCostSek / budgetLimitSek : 0;
  const budgetAlertStage: 'normal' | 'warning' | 'critical' =
    budgetLimitSek > 0 && budgetRatio >= 1
      ? 'critical'
      : budgetLimitSek > 0 && budgetRatio >= 0.8
      ? 'warning'
      : 'normal';

  useEffect(() => {
    if (budgetAlertStage === 'normal') {
      firedThresholdStageRef.current = 0;
      return;
    }
    if (budgetAlertStage === 'warning' && firedThresholdStageRef.current < 1) {
      firedThresholdStageRef.current = 1;
      if (soundAlertsEnabled) playThresholdAlertChime('warning');
    } else if (budgetAlertStage === 'critical' && firedThresholdStageRef.current < 2) {
      firedThresholdStageRef.current = 2;
      if (soundAlertsEnabled) playThresholdAlertChime('critical');
    }
  }, [budgetAlertStage, soundAlertsEnabled]);

  const decisionsCount = items.filter((i) => i.kind === 'decision').length;
  const actionsCount = items.filter((i) => i.kind === 'action').length;
  const totalOutcomes = decisionsCount + actionsCount;
  const referenceCost = elapsedSeconds > 10 ? liveCostSek : plannedTotalCostSek;
  const costPerOutcomeSek =
    totalOutcomes > 0 ? Math.round(referenceCost / totalOutcomes) : Math.round(referenceCost);

  // Efficiency Grade
  const getEfficiencyGrade = () => {
    if (totalOutcomes >= 4 && costPerOutcomeSek <= 900) {
      return { grade: 'A+', label: 'Högoktanigt beslutsmöte', color: 'text-emerald-700 bg-emerald-50 border-emerald-300' };
    }
    if (totalOutcomes >= 2) {
      return { grade: 'B+', label: 'Konstruktivt & fokuserat', color: 'text-amber-800 bg-amber-50 border-amber-300' };
    }
    return { grade: 'C', label: 'Fånga fler konkreta beslut', color: 'text-rose-700 bg-rose-50 border-rose-300' };
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

  const applyPreset = (title: string, mins: number, counts: Record<string, number>) => {
    playTickChime(740);
    setMeetingTitle(title);
    setPlannedMinutes(mins);
    setRoles((prev) => prev.map((r) => ({ ...r, count: counts[r.id] ?? 0 })));
  };

  const updateRoleCount = (id: string, delta: number) => {
    playTickChime(580);
    setRoles((prev) =>
      prev.map((r) => (r.id === id ? { ...r, count: Math.max(0, r.count + delta) } : r))
    );
  };

  const updateRoleRate = (id: string, rate: number) => {
    setRoles((prev) =>
      prev.map((r) => (r.id === id ? { ...r, rateSekPerHour: Math.max(0, rate) } : r))
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
    setItems((prev) => [item, ...prev]);
    setNewItemText('');
    setNewItemOwner('');
  };

  const handleExtractFromRawNotes = () => {
    if (!rawNotes.trim()) return;
    const lines = rawNotes.split('\n').map((l) => l.trim()).filter(Boolean);

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
      setItems((prev) => [...extracted, ...prev]);
      setRawNotes('');
      setShowRawParser(false);
    }
  };

  const handleImportCalendarInvite = (inputOverride?: string) => {
    const raw = (inputOverride ?? calendarInputText).trim();
    if (!raw) return;

    const unfolded = raw.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);

    let parsedSummary = '';
    let dtStart: Date | null = null;
    let dtEnd: Date | null = null;
    let attendeeCount = 0;
    let descriptionText = '';
    const agendaCandidateLines: string[] = [];

    for (const line of lines) {
      if (/^SUMMARY(?:;[^:]*)?:/i.test(line)) {
        parsedSummary = line.replace(/^SUMMARY(?:;[^:]*)?:/i, '').trim();
      } else if (/^DTSTART(?:;[^:]*)?:/i.test(line)) {
        dtStart = parseIcsTimestamp(line.replace(/^DTSTART(?:;[^:]*)?:/i, ''));
      } else if (/^DTEND(?:;[^:]*)?:/i.test(line)) {
        dtEnd = parseIcsTimestamp(line.replace(/^DTEND(?:;[^:]*)?:/i, ''));
      } else if (/^ATTENDEE(?:;[^:]*)?:/i.test(line)) {
        attendeeCount += 1;
      } else if (/^DESCRIPTION(?:;[^:]*)?:/i.test(line)) {
        descriptionText = line
          .replace(/^DESCRIPTION(?:;[^:]*)?:/i, '')
          .replace(/\\n/gi, '\n')
          .replace(/\\,/g, ',')
          .trim();
      } else if (
        !/^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|UID|DTSTAMP|ORGANIZER|LOCATION|STATUS|SEQUENCE|TRANSP)(?:;[^:]*)?:/i.test(
          line
        )
      ) {
        agendaCandidateLines.push(line);
      }
    }

    if (parsedSummary) {
      setMeetingTitle(parsedSummary);
    }

    let derivedMinutes = plannedMinutes;
    if (dtStart && dtEnd && dtEnd.getTime() > dtStart.getTime()) {
      const diffMins = Math.round((dtEnd.getTime() - dtStart.getTime()) / 60000);
      if (diffMins >= 5 && diffMins <= 480) {
        derivedMinutes = diffMins;
        setPlannedMinutes(diffMins);
      }
    }

    const sourceBody = descriptionText || agendaCandidateLines.join('\n');
    const rawStepLines = sourceBody
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 2 && !/^agenda:?$/i.test(l));

    const parsedSteps: AgendaStep[] = [];
    rawStepLines.forEach((line, idx) => {
      const cleanLine = line.replace(/^(\d+[.)]|[-*•])\s*/, '').trim();
      if (!cleanLine) return;

      const minMatch =
        cleanLine.match(/\((\d{1,3})\s*(?:min|m)\)/i) ||
        cleanLine.match(/\[(\d{1,3})\s*(?:min|m)\]/i) ||
        cleanLine.match(/^(\d{1,3})\s*(?:min|m)\s*(?:[-–:])\s*/i) ||
        cleanLine.match(/(?:[-–:])\s*(\d{1,3})\s*(?:min|m)$/i);

      const mins = minMatch ? Math.max(1, Number(minMatch[1])) : 0;
      const title = cleanLine
        .replace(/\((\d{1,3})\s*(?:min|m)\)/i, '')
        .replace(/\[(\d{1,3})\s*(?:min|m)\]/i, '')
        .replace(/^(\d{1,3})\s*(?:min|m)\s*(?:[-–:])\s*/i, '')
        .replace(/(?:[-–:])\s*(\d{1,3})\s*(?:min|m)$/i, '')
        .trim();

      if (title) {
        parsedSteps.push({
          id: `ics-${Date.now()}-${idx}`,
          title,
          minutes: mins,
          completed: false,
        });
      }
    });

    if (parsedSteps.length > 0) {
      const explicitSum = parsedSteps.reduce((s, a) => s + a.minutes, 0);
      const zeroCount = parsedSteps.filter((a) => a.minutes === 0).length;
      if (zeroCount > 0) {
        const remaining = Math.max(zeroCount * 5, derivedMinutes - explicitSum);
        const perZero = Math.max(5, Math.round(remaining / zeroCount));
        parsedSteps.forEach((s) => {
          if (s.minutes === 0) s.minutes = perZero;
        });
      }
      const totalStepMins = parsedSteps.reduce((s, a) => s + a.minutes, 0);
      if (!dtStart && totalStepMins >= 5) {
        derivedMinutes = totalStepMins;
        setPlannedMinutes(totalStepMins);
      }
      setAgenda(parsedSteps);
    }

    if (attendeeCount > 0) {
      setRoles((prev) =>
        prev.map((r, i) =>
          i === 0
            ? { ...r, count: Math.max(1, attendeeCount - 1) }
            : i === 1
            ? { ...r, count: 1 }
            : { ...r, count: 0 }
        )
      );
    }

    playTickChime(880);
    setCalendarImportNotice(
      `Importerade "${parsedSummary || meetingTitle}" (${derivedMinutes} min, ${
        parsedSteps.length || agenda.length
      } agendapunkter${attendeeCount > 0 ? `, ${attendeeCount} deltagare` : ''})`
    );
    setCalendarInputText('');
    setTimeout(() => setCalendarImportNotice(null), 5000);
  };

  const handleIcsFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      if (content) {
        setCalendarInputText(content);
        handleImportCalendarInvite(content);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
            decisions.map((d) => `• ${d.text} _(@${d.owner})_`).join('\n')
          : null,
        actions.length > 0
          ? `🚀 *ACTION ITEMS (${actions.length}):*\n` +
            actions
              .map((a) => `• [ ] *${a.owner}:* ${a.text} _(Deadline: ${a.due})_`)
              .join('\n')
          : null,
        blockers.length > 0
          ? `⚠️ *RISKER / BLOCKERS (${blockers.length}):*\n` +
            blockers.map((b) => `• ${b.text} _(@${b.owner})_`).join('\n')
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
    <div className="min-h-screen bg-[#F4F4F0] text-[#121212] flex flex-col font-sans selection:bg-[#EA580C] selection:text-white">
      {/* 1. SWISS EDITORIAL MASTER HEADER */}
      <header className="sticky top-0 z-30 border-b border-[#E2E2DC] bg-[#F4F4F0]/95 backdrop-blur-md px-4 sm:px-6 py-2.5 print:hidden">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Brand & Inline Title */}
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="flex items-center gap-2 select-none">
              <span className="w-6 h-6 rounded bg-[#121212] flex items-center justify-center text-white font-mono text-[11px] font-bold">
                M
              </span>
              <span className="font-bold tracking-tight text-sm uppercase">
                MötesKoll
              </span>
              <span className="text-[10px] font-mono text-[#666660] border border-[#D4D4CE] px-1 py-0.2 rounded bg-[#FFFFFF]">
                INSTRUMENT 01
              </span>
            </div>

            <span className="text-[#C8C8BF] hidden md:inline">/</span>

            <input
              type="text"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              placeholder="Namnge mötet..."
              className="flex-1 sm:w-60 md:w-72 font-semibold text-xs sm:text-sm bg-transparent border-b border-transparent hover:border-[#C8C8BF] focus:border-[#EA580C] focus:outline-none py-0.5 text-[#121212]"
            />
          </div>

          {/* Quiet Header Drawer Triggers */}
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium w-full sm:w-auto justify-end">
            {/* Participants Drawer Trigger */}
            <button
              onClick={() => {
                playTickChime(680);
                setIsParticipantsOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#E2E2DC] bg-[#FFFFFF] hover:border-[#121212] text-[#121212] transition cursor-pointer shadow-2xs"
              title="Hantera deltagare och konsulttimarvoden"
            >
              <Users className="w-3.5 h-3.5 text-[#EA580C]" />
              <span className="font-mono font-bold text-xs">{totalAttendees} pers</span>
              <span className="text-[11px] text-[#666660] hidden md:inline">
                ({Math.round(burnRatePerHourSek).toLocaleString('sv-SE')} kr/h)
              </span>
              <ChevronDown className="w-3 h-3 text-[#666660]" />
            </button>

            {/* Agenda Drawer Trigger */}
            <button
              onClick={() => {
                playTickChime(680);
                setIsAgendaOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#E2E2DC] bg-[#FFFFFF] hover:border-[#121212] text-[#121212] transition cursor-pointer shadow-2xs"
              title="Öppna agendapunkter och .ics-kalenderimport"
            >
              <Calendar className="w-3.5 h-3.5 text-[#666660]" />
              <span className="text-xs">Agenda</span>
              <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-[#EFEFEA] text-[#666660]">
                {agenda.filter((a) => a.completed).length}/{agenda.length}
              </span>
              <ChevronDown className="w-3 h-3 text-[#666660]" />
            </button>

            {/* Saved Archive Trigger */}
            <button
              onClick={() => {
                playTickChime(680);
                setIsArchiveOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#E2E2DC] bg-[#FFFFFF] hover:border-[#121212] text-[#121212] transition cursor-pointer shadow-2xs"
              title="Öppna sparade möteskvitton (SQLite)"
            >
              <History className="w-3.5 h-3.5 text-[#666660]" />
              <span className="hidden sm:inline text-xs">Arkiv</span>
              <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-[#EFEFEA] text-[#666660]">
                {savedMeetings.length}
              </span>
            </button>

            {/* Print Kvitto */}
            <button
              onClick={() => window.print()}
              className="p-1.5 rounded border border-[#E2E2DC] bg-[#FFFFFF] hover:border-[#121212] text-[#121212] transition cursor-pointer shadow-2xs"
              title="Skriv ut formellt möteskvitto / PDF"
            >
              <Printer className="w-3.5 h-3.5 text-[#666660]" />
            </button>

            {/* Pro Pill */}
            <button
              onClick={() => setIsProModalOpen(true)}
              className="px-2 py-1 rounded bg-[#EFEFEA] hover:bg-[#E2E2DC] border border-[#D4D4CE] font-mono font-bold text-[10px] text-[#666660] hover:text-[#121212] transition cursor-pointer"
            >
              PRO
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN SWISS INSTRUMENT WORKSPACE (90% Visual Weight on Ticker & Decision Pad) */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 print:hidden">
        
        {/* BRAUN MASTER STOPWATCH & LIVE COST TICKER CARD */}
        <section className="bg-[#FFFFFF] border-2 border-[#121212] rounded-lg shadow-sm p-5 sm:p-7 space-y-5">
          {/* Top Bar: Live Status & Budget Threshold Badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E2DC] pb-4">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isRunning
                    ? 'bg-[#EA580C] animate-pulse ring-2 ring-[#EA580C]/20'
                    : 'bg-[#121212]'
                }`}
              />
              <span className="font-mono text-xs uppercase tracking-wider font-bold">
                {isRunning ? 'MÖTESTAXAMETER AKTIV' : 'MÖTE REDO FÖR START'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`px-2 py-0.5 rounded border text-[11px] font-mono font-bold ${efficiency.color}`}
              >
                ROI: {efficiency.grade} • {efficiency.label}
              </span>

              {/* Sound Chime Toggle */}
              <button
                onClick={() => setSoundAlertsEnabled(!soundAlertsEnabled)}
                className={`p-1 rounded border text-[11px] transition cursor-pointer ${
                  soundAlertsEnabled
                    ? 'bg-[#EFEFEA] border-[#C8C8BF] text-[#121212]'
                    : 'bg-transparent border-transparent text-[#999990]'
                }`}
                title={soundAlertsEnabled ? 'Ljudlarm aktivt vid budgettak' : 'Tyst läge'}
              >
                {soundAlertsEnabled ? <Bell className="w-3.5 h-3.5 text-[#EA580C]" /> : <BellOff className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Odometer & Duration Readout */}
          <div className="flex flex-col lg:flex-row lg:items-baseline justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[11px] font-mono uppercase tracking-widest text-[#666660] font-bold">
                ACKUMULERAD MÖTESKOSTNAD
              </div>
              <div className="font-mono font-extrabold text-5xl sm:text-7xl tracking-tighter text-[#121212] tabular-nums">
                {liveCostSek.toLocaleString('sv-SE', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="text-2xl sm:text-3xl text-[#EA580C] font-normal ml-2">
                  SEK
                </span>
              </div>
            </div>

            {/* Stopwatch Elapsed vs Planned Timebox */}
            <div className="space-y-1 self-start lg:self-end text-left lg:text-right">
              <div className="text-[11px] font-mono uppercase tracking-widest text-[#666660] font-bold">
                TIDBOX ({plannedMinutes} MIN PLANERAT)
              </div>
              <div className="font-mono text-3xl sm:text-4xl font-bold text-[#121212] tabular-nums">
                {formatDuration(elapsedSeconds)}
                <span className="text-sm font-normal text-[#666660] ml-1">
                  / {plannedMinutes}:00
                </span>
              </div>
            </div>
          </div>

          {/* Precision Linear Timebox Progress Hairline */}
          <div className="space-y-1">
            <div className="w-full h-2 bg-[#EFEFEA] rounded-xs overflow-hidden border border-[#E2E2DC]">
              <div
                className={`h-full transition-all duration-200 ${
                  progressPct >= 100 ? 'bg-[#DC2626]' : 'bg-[#EA580C]'
                }`}
                style={{ width: `${Math.max(1, progressPct)}%` }}
              />
            </div>
          </div>

          {/* Live Critical / Warning Banner */}
          {budgetAlertStage !== 'normal' && (
            <div
              className={`px-3.5 py-2.5 rounded border text-xs font-mono font-bold flex items-center justify-between gap-3 ${
                budgetAlertStage === 'critical'
                  ? 'bg-[#FEF2F2] border-[#DC2626] text-[#DC2626]'
                  : 'bg-[#FFFBEB] border-[#D97706] text-[#D97706]'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {budgetAlertStage === 'critical'
                    ? `BUDGETTAK PASSERAT (${budgetLimitSek.toLocaleString('sv-SE')} kr) — lås beslut och avsluta!`
                    : `VARNING: ${Math.round(budgetRatio * 100)}% av budgettaket (${budgetLimitSek.toLocaleString('sv-SE')} kr) är förbrukat.`}
                </span>
              </div>
              <span>
                {Math.round(liveCostSek).toLocaleString('sv-SE')} / {budgetLimitSek.toLocaleString('sv-SE')} kr
              </span>
            </div>
          )}

          {/* Primary Braun Stopwatch Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  playTickChime(isRunning ? 520 : 880);
                  setIsRunning(!isRunning);
                }}
                className={`px-6 py-3 rounded font-mono font-black text-xs uppercase tracking-wider flex items-center gap-2 transition cursor-pointer shadow-sm ${
                  isRunning
                    ? 'bg-[#EA580C] hover:bg-[#C2410C] text-white'
                    : 'bg-[#121212] hover:bg-black text-white'
                }`}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4 fill-white" />
                    <span>PAUSA TAXAMETER</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>STARTA MÖTE</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  playTickChime(640);
                  setElapsedSeconds((prev) => prev + 300);
                }}
                className="px-3 py-3 rounded bg-[#FFFFFF] hover:bg-[#EFEFEA] border border-[#C8C8BF] text-xs font-mono font-bold text-[#121212] transition cursor-pointer"
                title="Simulera +5 minuter"
              >
                +5m
              </button>

              <button
                onClick={() => {
                  if (burnRatePerSecSek > 0) {
                    setElapsedSeconds((prev) => prev + 1000 / burnRatePerSecSek);
                  }
                }}
                className="px-3 py-3 rounded bg-[#FFFFFF] hover:bg-[#EFEFEA] border border-[#C8C8BF] text-xs font-mono font-bold text-[#EA580C] transition cursor-pointer"
                title="Simulera +1 000 kr på taxametern"
              >
                +1 000 kr
              </button>

              <button
                onClick={() => {
                  playTickChime(440);
                  setIsRunning(false);
                  setElapsedSeconds(0);
                  firedThresholdStageRef.current = 0;
                }}
                className="px-3 py-3 rounded bg-[#FFFFFF] hover:bg-[#EFEFEA] border border-[#C8C8BF] text-xs font-mono font-bold text-[#666660] hover:text-[#121212] transition cursor-pointer"
                title="Återställ klocka"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Budget Limit Selector */}
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="text-[11px] uppercase text-[#666660]">Tak:</span>
              {[2500, 5000, 10000].map((b) => (
                <button
                  key={b}
                  onClick={() => {
                    playTickChime(700);
                    setBudgetLimitSek(b);
                  }}
                  className={`px-2 py-1 rounded text-xs font-bold transition cursor-pointer ${
                    budgetLimitSek === b
                      ? 'bg-[#121212] text-white'
                      : 'bg-[#EFEFEA] border border-[#D4D4CE] text-[#666660] hover:text-[#121212]'
                  }`}
                >
                  {b.toLocaleString('sv-SE')} kr
                </button>
              ))}
            </div>
          </div>

          {/* Precision Metrics Ledger Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-[#E2E2DC] text-xs font-mono">
            <div className="p-2.5 rounded bg-[#FBFBFA] border border-[#E2E2DC]">
              <div className="text-[10px] uppercase text-[#666660]">BRÄNNTAKT</div>
              <div className="font-bold text-sm text-[#121212] mt-0.5">
                {Math.round(burnRatePerMinSek)} kr/min
              </div>
            </div>

            <div className="p-2.5 rounded bg-[#FBFBFA] border border-[#E2E2DC]">
              <div className="text-[10px] uppercase text-[#666660]">SNITT / BESLUT</div>
              <div className="font-bold text-sm text-[#EA580C] mt-0.5">
                {costPerOutcomeSek.toLocaleString('sv-SE')} kr
              </div>
            </div>

            <div className="p-2.5 rounded bg-[#FBFBFA] border border-[#E2E2DC]">
              <div className="text-[10px] uppercase text-[#666660]">DELTAGARE</div>
              <div className="font-bold text-sm text-[#121212] mt-0.5">
                {totalAttendees} personer
              </div>
            </div>

            <div className="p-2.5 rounded bg-[#FBFBFA] border border-[#E2E2DC]">
              <div className="text-[10px] uppercase text-[#666660]">MOTSVARAR FIKA</div>
              <div className="font-bold text-sm text-[#121212] mt-0.5 flex items-center gap-1">
                <Coffee className="w-3.5 h-3.5 text-[#666660]" />
                <span>{Math.max(1, Math.round(referenceCost / 52))} koppar</span>
              </div>
            </div>
          </div>
        </section>

        {/* SWISS ACTION & DECISION LEDGER (THE PAD) */}
        <section className="bg-[#FFFFFF] border-2 border-[#121212] rounded-lg shadow-sm p-5 sm:p-7 space-y-5">
          {/* Pad Header & Quick Raw Notes Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E2DC] pb-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#EA580C] font-bold block">
                BESLUTSPROTOKOLL & RESULTAT
              </div>
              <h2 className="font-bold text-xl tracking-tight text-[#121212]">
                Action-Item & Beslutsblock{' '}
                <span className="font-mono text-xs font-normal text-[#666660]">
                  ({decisionsCount} beslut • {actionsCount} actions)
                </span>
              </h2>
            </div>

            <button
              onClick={() => setShowRawParser(!showRawParser)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#EFEFEA] hover:bg-[#E2E2DC] border border-[#C8C8BF] text-xs font-medium text-[#121212] transition cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-[#EA580C]" />
              <span>{showRawParser ? 'Dölj råtext-tolk' : 'Klistra in råa anteckningar'}</span>
            </button>
          </div>

          {/* Collapsible Raw Notes Parser */}
          {showRawParser && (
            <div className="p-4 rounded border border-[#C8C8BF] bg-[#FBFBFA] space-y-3 animate-in fade-in duration-150">
              <div className="text-xs font-mono text-[#666660]">
                Klistra in mötesanteckningar med <strong className="text-[#121212]">BESLUT:</strong>,{' '}
                <strong className="text-[#121212]">TODO:</strong>, <strong className="text-[#121212]">RISK:</strong>,{' '}
                och <strong className="text-[#EA580C]">@namn</strong>:
              </div>
              <textarea
                value={rawNotes}
                onChange={(e) => setRawNotes(e.target.value)}
                rows={4}
                placeholder={`BESLUT: Kör Stripe + Swish direkt utan tredjeparts-annonser @Viktor\nTODO: Sätt upp SQLite-backuper innan fredag @Erik\nRISK: Tredjeparts-API har rate-limit vid hög last @Anna`}
                className="w-full p-3 rounded border border-[#C8C8BF] bg-[#FFFFFF] text-xs font-mono text-[#121212] focus:outline-none focus:border-[#EA580C]"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleExtractFromRawNotes}
                  className="px-4 py-2 rounded bg-[#121212] hover:bg-black text-white font-mono text-xs font-bold transition cursor-pointer"
                >
                  ⚡ Tolka beslut & actions nu
                </button>
              </div>
            </div>
          )}

          {/* Quick Item Add Form */}
          <form
            onSubmit={handleAddItem}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-[#FBFBFA] border border-[#E2E2DC] p-2 rounded"
          >
            <select
              value={newItemKind}
              onChange={(e) => setNewItemKind(e.target.value as ItemKind)}
              className="px-2.5 py-1.5 rounded bg-[#FFFFFF] border border-[#C8C8BF] text-xs font-bold text-[#121212] focus:outline-none"
            >
              <option value="action">🎯 Action</option>
              <option value="decision">✅ Beslut</option>
              <option value="blocker">⚠️ Risk</option>
            </select>

            <input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Beskriv beslut eller åtgärd..."
              className="flex-1 px-3 py-1.5 rounded bg-[#FFFFFF] border border-[#C8C8BF] text-xs text-[#121212] focus:outline-none focus:border-[#EA580C]"
            />

            <input
              type="text"
              value={newItemOwner}
              onChange={(e) => setNewItemOwner(e.target.value)}
              placeholder="@Ansvarig"
              className="w-28 px-2.5 py-1.5 rounded bg-[#FFFFFF] border border-[#C8C8BF] text-xs font-mono text-[#121212] focus:outline-none"
            />

            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-[#121212] hover:bg-black text-white font-mono font-bold text-xs uppercase transition cursor-pointer"
            >
              + Lägg till
            </button>
          </form>

          {/* Captured Items List */}
          <div className="divide-y divide-[#E2E2DC] border border-[#E2E2DC] rounded bg-[#FFFFFF]">
            {items.map((item) => (
              <div
                key={item.id}
                className={`p-3 sm:px-4 sm:py-3 flex items-center justify-between gap-3 transition ${
                  item.done ? 'bg-[#FBFBFA] opacity-60 line-through' : 'hover:bg-[#FBFBFA]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
                      )
                    }
                    className="text-[#666660] hover:text-[#121212] shrink-0 cursor-pointer"
                  >
                    {item.done ? (
                      <CheckSquare className="w-4 h-4 text-[#16A34A]" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>

                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 ${
                      item.kind === 'decision'
                        ? 'bg-[#ECFDF5] text-[#16A34A] border border-[#A7F3D0]'
                        : item.kind === 'blocker'
                        ? 'bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]'
                        : 'bg-[#FFF7ED] text-[#EA580C] border border-[#FFEDD5]'
                    }`}
                  >
                    {item.kind === 'decision'
                      ? 'BESLUT'
                      : item.kind === 'blocker'
                      ? 'RISK'
                      : 'ACTION'}
                  </span>

                  <span className="text-xs sm:text-sm font-medium text-[#121212] truncate">
                    {item.text}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-xs text-[#EA580C] font-semibold">
                    @{item.owner}
                  </span>
                  <span className="text-[11px] font-mono text-[#666660] hidden sm:inline">
                    ({item.due})
                  </span>
                  <button
                    onClick={() =>
                      setItems((prev) => prev.filter((i) => i.id !== item.id))
                    }
                    className="p-1 text-[#999990] hover:text-[#DC2626] transition cursor-pointer"
                    title="Ta bort"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 1-Click Export Bar (Slack / Markdown & SQLite Save) */}
          <div className="pt-3 border-t border-[#E2E2DC] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 bg-[#EFEFEA] p-0.5 rounded border border-[#E2E2DC] text-xs font-mono">
              <button
                onClick={() => setExportFormat('slack')}
                className={`px-2.5 py-1 rounded transition cursor-pointer ${
                  exportFormat === 'slack'
                    ? 'bg-[#121212] text-white font-bold'
                    : 'text-[#666660] hover:text-[#121212]'
                }`}
              >
                Slack / Teams
              </button>
              <button
                onClick={() => setExportFormat('markdown')}
                className={`px-2.5 py-1 rounded transition cursor-pointer ${
                  exportFormat === 'markdown'
                    ? 'bg-[#121212] text-white font-bold'
                    : 'text-[#666660] hover:text-[#121212]'
                }`}
              >
                Markdown (Notion)
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopyExport(exportFormat)}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded bg-[#121212] hover:bg-black text-white font-mono text-xs font-bold transition cursor-pointer shadow-xs"
              >
                {copiedMode === exportFormat ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                    <span>Kopierat!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Kopiera protokoll</span>
                  </>
                )}
              </button>

              <button
                onClick={handleSaveMeeting}
                disabled={isSaving}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded bg-[#FFFFFF] hover:bg-[#EFEFEA] border border-[#121212] text-[#121212] font-mono text-xs font-bold transition cursor-pointer shadow-xs"
              >
                <Save className="w-3.5 h-3.5 text-[#EA580C]" />
                <span>{isSaving ? 'Sparar...' : 'Spara i Arkiv'}</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* 3. QUIET DRAWERS / MODALS */}

      {/* DRAWER: PARTICIPANTS & HOURLY RATES */}
      {isParticipantsOpen && (
        <div
          onClick={() => setIsParticipantsOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-lg w-full bg-[#FFFFFF] border-2 border-[#121212] rounded-lg shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-3">
              <div>
                <h3 className="font-bold text-lg text-[#121212]">
                  Deltagare & Timarvoden
                </h3>
                <p className="text-xs text-[#666660]">
                  Ställ in antal deltagare och marknadsarvoden per roll
                </p>
              </div>
              <button
                onClick={() => setIsParticipantsOpen(false)}
                className="p-1 rounded text-[#666660] hover:text-[#121212] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase text-[#666660] block font-bold">
                Snabbmallar:
              </span>
              <div className="grid grid-cols-2 gap-1.5">
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
                  className="p-2 rounded bg-[#FBFBFA] border border-[#E2E2DC] hover:border-[#121212] text-left text-xs font-semibold transition cursor-pointer"
                >
                  ⚡ Standup (6p, 15m)
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
                  className="p-2 rounded bg-[#FBFBFA] border border-[#E2E2DC] hover:border-[#121212] text-left text-xs font-semibold transition cursor-pointer"
                >
                  🏗️ Arkitektur (4p, 45m)
                </button>
                <button
                  onClick={() =>
                    applyPreset('Sprint-Planering', 60, {
                      dev: 5,
                      lead: 1,
                      pm: 1,
                      ux: 1,
                      exec: 0,
                    })
                  }
                  className="p-2 rounded bg-[#FBFBFA] border border-[#E2E2DC] hover:border-[#121212] text-left text-xs font-semibold transition cursor-pointer"
                >
                  🎯 Sprint (8p, 60m)
                </button>
                <button
                  onClick={() =>
                    applyPreset('Kund-Steering', 45, {
                      dev: 1,
                      lead: 1,
                      pm: 1,
                      ux: 0,
                      exec: 2,
                    })
                  }
                  className="p-2 rounded bg-[#FBFBFA] border border-[#E2E2DC] hover:border-[#121212] text-left text-xs font-semibold transition cursor-pointer"
                >
                  💼 Steering (5p, 45m)
                </button>
              </div>
            </div>

            {/* Roles Table */}
            <div className="space-y-2">
              {roles.map((r) => (
                <div
                  key={r.id}
                  className="p-2.5 rounded border border-[#E2E2DC] bg-[#FBFBFA] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-[#121212] truncate">
                      {r.labelSv}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input
                        type="number"
                        value={r.rateSekPerHour}
                        onChange={(e) => updateRoleRate(r.id, Number(e.target.value))}
                        className="w-20 px-1.5 py-0.5 rounded bg-white border border-[#C8C8BF] font-mono text-xs text-[#121212]"
                      />
                      <span className="text-[11px] font-mono text-[#666660]">kr/h</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => updateRoleCount(r.id, -1)}
                      className="w-7 h-7 rounded border border-[#C8C8BF] bg-white hover:bg-[#EFEFEA] flex items-center justify-center text-[#121212] cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-sm text-[#121212]">
                      {r.count}
                    </span>
                    <button
                      onClick={() => updateRoleCount(r.id, 1)}
                      className="w-7 h-7 rounded border border-[#C8C8BF] bg-white hover:bg-[#EFEFEA] flex items-center justify-center text-[#121212] cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Payroll Tax & Close */}
            <div className="flex items-center justify-between pt-3 border-t border-[#E2E2DC]">
              <button
                onClick={() => setIncludePayrollTax(!includePayrollTax)}
                className={`px-3 py-1.5 rounded border text-xs font-bold transition cursor-pointer ${
                  includePayrollTax
                    ? 'bg-[#121212] text-white border-[#121212]'
                    : 'bg-[#FBFBFA] border-[#C8C8BF] text-[#666660]'
                }`}
              >
                {includePayrollTax ? '✓ Inkl. 31.42% Arbetsgivaravgift' : '+ 31.42% Arbetsgivaravgift'}
              </button>

              <button
                onClick={() => setIsParticipantsOpen(false)}
                className="px-4 py-1.5 rounded bg-[#EA580C] hover:bg-[#C2410C] text-white font-mono text-xs font-bold transition cursor-pointer"
              >
                Klar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DRAWER: AGENDA & .ICS IMPORTER */}
      {isAgendaOpen && (
        <div
          onClick={() => setIsAgendaOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-lg w-full bg-[#FFFFFF] border-2 border-[#121212] rounded-lg shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-3">
              <div>
                <h3 className="font-bold text-lg text-[#121212]">
                  Agenda & Tidbox-Pacer
                </h3>
                <p className="text-xs text-[#666660]">
                  Totalt {agenda.reduce((s, a) => s + a.minutes, 0)} min planerat
                </p>
              </div>
              <button
                onClick={() => setIsAgendaOpen(false)}
                className="p-1 rounded text-[#666660] hover:text-[#121212] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* .ICS Calendar Importer Box */}
            <div className="p-3.5 rounded border border-[#C8C8BF] bg-[#FBFBFA] space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-[#121212]">
                <span>Importera från kalender (.ics):</span>
                <label className="px-2.5 py-1 rounded bg-white border border-[#C8C8BF] hover:border-[#121212] text-[11px] font-mono cursor-pointer flex items-center gap-1">
                  <Upload className="w-3 h-3 text-[#EA580C]" />
                  <span>Välj .ics</span>
                  <input
                    type="file"
                    accept=".ics,text/calendar"
                    onChange={handleIcsFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <textarea
                value={calendarInputText}
                onChange={(e) => setCalendarInputText(e.target.value)}
                rows={3}
                placeholder="Eller klistra in VEVENT-data / agendarader här..."
                className="w-full p-2.5 rounded border border-[#C8C8BF] bg-white text-xs font-mono text-[#121212] focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleImportCalendarInvite()}
                  className="px-3 py-1 rounded bg-[#121212] hover:bg-black text-white font-mono text-xs font-bold cursor-pointer"
                >
                  Tolka .ics & uppdatera agenda
                </button>
              </div>
            </div>

            {calendarImportNotice && (
              <div className="p-2.5 rounded bg-[#ECFDF5] border border-[#A7F3D0] text-[#16A34A] text-xs font-mono font-bold">
                {calendarImportNotice}
              </div>
            )}

            {/* Agenda Steps List */}
            <div className="divide-y divide-[#E2E2DC] border border-[#E2E2DC] rounded bg-white">
              {agenda.map((step, idx) => (
                <div
                  key={step.id}
                  onClick={() => {
                    playTickChime(700);
                    setAgenda((prev) =>
                      prev.map((a) =>
                        a.id === step.id ? { ...a, completed: !a.completed } : a
                      )
                    );
                  }}
                  className={`p-3 flex items-center justify-between gap-3 cursor-pointer transition ${
                    step.completed ? 'bg-[#FBFBFA] opacity-60 line-through' : 'hover:bg-[#FBFBFA]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        step.completed ? 'text-[#16A34A]' : 'text-[#C8C8BF]'
                      }`}
                    />
                    <span className="text-xs font-bold truncate">
                      {idx + 1}. {step.title}
                    </span>
                  </div>
                  <div className="font-mono text-xs font-bold text-[#EA580C] shrink-0">
                    {step.minutes}m
                  </div>
                </div>
              ))}
            </div>

            {/* Add Agenda Step Form */}
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
              className="flex gap-2"
            >
              <input
                type="text"
                value={newAgendaTitle}
                onChange={(e) => setNewAgendaTitle(e.target.value)}
                placeholder="Ny agendapunkt..."
                className="flex-1 px-3 py-1.5 rounded border border-[#C8C8BF] text-xs"
              />
              <input
                type="number"
                value={newAgendaMins}
                onChange={(e) => setNewAgendaMins(Number(e.target.value))}
                className="w-16 px-2 py-1.5 rounded border border-[#C8C8BF] text-xs font-mono text-center"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded bg-[#121212] hover:bg-black text-white text-xs font-mono font-bold cursor-pointer"
              >
                + Lägg till
              </button>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER: SAVED MEETINGS ARCHIVE (SQLITE) */}
      {isArchiveOpen && (
        <div
          onClick={() => setIsArchiveOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-2xl w-full bg-[#FFFFFF] border-2 border-[#121212] rounded-lg shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-3">
              <div>
                <h3 className="font-bold text-lg text-[#121212]">
                  Mötesarkiv (SQLite Databas)
                </h3>
                <p className="text-xs text-[#666660]">
                  Tidigare sparade möteskvitton och kostnadsanalyser
                </p>
              </div>
              <button
                onClick={() => setIsArchiveOpen(false)}
                className="p-1 rounded text-[#666660] hover:text-[#121212] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {savedMeetings.length === 0 ? (
              <div className="p-8 text-center text-xs font-mono text-[#666660]">
                Inga sparade möten ännu. Klicka på "Spara i Arkiv" för att logga detta möte.
              </div>
            ) : (
              <div className="space-y-2.5">
                {savedMeetings.map((m) => (
                  <div
                    key={m.id}
                    className="p-3.5 rounded border border-[#E2E2DC] bg-[#FBFBFA] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-sm text-[#121212]">{m.title}</div>
                      <div className="font-mono text-xs text-[#666660] mt-0.5">
                        {new Date(m.createdAt).toLocaleDateString('sv-SE')} • {m.attendeeCount} pers •{' '}
                        {Math.round(m.durationSeconds / 60)} min
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono font-bold text-base text-[#EA580C]">
                          {Math.round(m.totalCostSek).toLocaleString('sv-SE')} SEK
                        </div>
                        <div className="font-mono text-[11px] text-[#16A34A]">
                          {m.decisionsCount} beslut • {m.actionsCount} actions
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteSavedMeeting(m.id)}
                        className="p-1 text-[#999990] hover:text-[#DC2626] transition cursor-pointer"
                        title="Radera"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRO MODAL (HARKCO VALUE EXCHANGE) */}
      {isProModalOpen && (
        <div
          onClick={() => setIsProModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full bg-[#FFFFFF] border-2 border-[#121212] rounded-lg shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-3">
              <div className="flex items-center gap-2 text-[#121212] font-black text-base">
                <Award className="w-5 h-5 text-[#EA580C]" />
                <span>MötesKoll Team Pro — 149 kr</span>
              </div>
              <button
                onClick={() => setIsProModalOpen(false)}
                className="p-1 rounded text-[#666660] hover:text-[#121212] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#666660] leading-relaxed">
              Byggd enligt Harkco-principerna: <strong>100% fri från annonser och datainsamling</strong>. Engångsköp för konsultteam och ingenjörsledare:
            </p>
            <ul className="space-y-2 text-xs text-[#121212] font-medium">
              <li>✅ Obegränsad lokal SQLite-historik & kvartalsrapporter</li>
              <li>✅ Automatisk webhook-export till Slack & Notion</li>
              <li>✅ Anpassade timarvodeslistor och fakturaunderlag</li>
            </ul>
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setIsProModalOpen(false)}
                className="px-4 py-2 rounded bg-[#121212] hover:bg-black text-white font-mono text-xs font-bold cursor-pointer"
              >
                Stäng förhandsvisning
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. PRINTABLE A4 SWISS EXPENSE RECEIPT */}
      <div
        id="moteskoll-printable-receipt"
        className="hidden print:block p-8 bg-white text-black space-y-6 font-mono"
      >
        <div className="border-b-2 border-black pb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight">
              MÖTESKOLL — FORMELT MÖTESKVITTO
            </h1>
            <p className="text-sm font-bold mt-1">{meetingTitle}</p>
          </div>
          <div className="text-right text-xs">
            <div>Datum: {new Date().toLocaleDateString('sv-SE')}</div>
            <div>Deltagare: {totalAttendees} pers</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-b border-black pb-4 text-xs">
          <div>
            <div className="uppercase text-gray-500">Möteskostnad</div>
            <div className="text-lg font-black mt-0.5">
              {Math.round(referenceCost).toLocaleString('sv-SE')} SEK
            </div>
          </div>
          <div>
            <div className="uppercase text-gray-500">Snitt / Beslut</div>
            <div className="text-lg font-black mt-0.5">
              {costPerOutcomeSek.toLocaleString('sv-SE')} SEK
            </div>
          </div>
          <div>
            <div className="uppercase text-gray-500">ROI-Betyg</div>
            <div className="text-lg font-black mt-0.5">{efficiency.grade}</div>
          </div>
        </div>

        <pre className="text-xs whitespace-pre-wrap font-mono">
          {buildExportString('markdown')}
        </pre>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#E2E2DC] py-4 text-center text-xs font-mono text-[#666660] print:hidden">
        MÖTESKOLL • HARKCO STUDIO (SWISS MODERNIST EDITION)
      </footer>
    </div>
  );
}

export default App;
