import { useEffect, useState } from "react";
import { BOT_PROFILES } from "../ai/profiles";
import { useClientStore } from "../net/clientSession";
import { HOST_SEAT, useHostStore } from "../net/hostSession";
import { type LobbySeat, MAX_SEATS, type RoomSettings, TURN_TIMES } from "../net/protocol";
import { useGameStore } from "../store/gameStore";
import { STYLE_COLORS } from "./constants";
import { chips } from "./format";
import { Icon } from "./icons";
import { MenuScene, ScreenHeader, STACKS, STAKES, Tile } from "./Menu";

/** "K7QM2XPA" → "K7QM-2XPA". */
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

type Tab = "host" | "join";

export function MultiplayerScreen({ onSettings }: { onSettings: () => void }) {
  const hostStatus = useHostStore((s) => s.status);
  const clientStatus = useClientStore((s) => s.status);
  const goTo = useGameStore((s) => s.goTo);
  const [tab, setTab] = useState<Tab>("host");

  const hosting = hostStatus !== "idle";
  const joined = clientStatus === "lobby" || clientStatus === "playing";
  const back = () => {
    if (hosting) useHostStore.getState().close();
    if (clientStatus !== "idle") useClientStore.getState().leave();
    goTo("menu");
  };

  return (
    <MenuScene onSettings={onSettings}>
      <div className="menu-panel">
        <ScreenHeader title="Multiplayer" onBack={back} />
        {hosting ? (
          <HostLobby />
        ) : joined ? (
          <JoinLobby />
        ) : (
          <>
            <div className="segmented mp-tabs" role="tablist">
              <button role="tab" aria-selected={tab === "host"} aria-pressed={tab === "host"} onClick={() => setTab("host")}>
                Host a game
              </button>
              <button role="tab" aria-selected={tab === "join"} aria-pressed={tab === "join"} onClick={() => setTab("join")}>
                Join a game
              </button>
            </div>
            {tab === "host" ? <HostForm /> : <JoinForm />}
          </>
        )}
      </div>
    </MenuScene>
  );
}

// ---------------------------------------------------------------------------
// Hosting

function HostForm() {
  const { setup, updateSetup, updateRoom, open, status, error } = useHostStore();
  return (
    <>
      <p className="text-2">
        Your computer runs the game. Friends on the same Wi-Fi find your room automatically; friends elsewhere connect to
        your IP address. Either way they need the room code you'll get next.
      </p>
      <div className="setup-columns">
        <section className="setup-row">
          <h2>Your name</h2>
          <input
            className="mp-input"
            value={setup.hostName}
            maxLength={16}
            onChange={(e) => updateSetup({ hostName: e.target.value })}
            aria-label="Your name"
          />
        </section>
        <section className="setup-row">
          <h2>Room name</h2>
          <input
            className="mp-input"
            value={setup.room.name}
            maxLength={24}
            onChange={(e) => updateRoom({ name: e.target.value })}
            aria-label="Room name"
          />
        </section>
      </div>
      <details className="mp-advanced">
        <summary>Advanced</summary>
        <label className="field">
          <span>
            Port
            <div className="desc">The TCP port players connect to. Forward this one on your router for internet play.</div>
          </span>
          <input
            className="mp-input num"
            style={{ width: "7rem" }}
            type="number"
            min={1024}
            max={65535}
            value={setup.port}
            onChange={(e) => updateSetup({ port: Math.max(1024, Math.min(65535, Math.round(Number(e.target.value)) || 47820)) })}
          />
        </label>
      </details>
      {error && <p className="mp-error" role="alert">{error}</p>}
      <button
        className="menu-btn primary deal-btn"
        onClick={() => void open()}
        disabled={status === "opening" || !setup.hostName.trim()}
      >
        {status === "opening" ? "Opening…" : <>Open room <Icon name="play" size="0.8em" /></>}
      </button>
    </>
  );
}

function HostLobby() {
  const { info, setup, members, locked, alert, status, setBots, updateSetup, updateRoom, kick, setLocked, regenerateCode, start, close } =
    useHostStore();
  const [copied, setCopied] = useState(false);
  if (!info) return <p className="text-2">Opening the room…</p>;

  const seatsUsed = 1 + members.length + setup.bots;
  const maxBots = MAX_SEATS - 1 - members.length;
  const copy = () => {
    void navigator.clipboard?.writeText(formatCode(info.code)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const addr = info.lanIps[0] ? `${info.lanIps[0]}:${info.port}` : `this computer's IP, port ${info.port}`;
  const seats: LobbySeat[] = [
    { id: HOST_SEAT, name: setup.hostName, kind: "host" },
    ...members.map((m): LobbySeat => ({ id: m.seatId, name: m.name, kind: "remote" })),
  ];

  return (
    <>
      {alert && (
        <div className="mp-alert" role="alert">
          <strong>Someone is guessing your room code.</strong> New players are blocked until you make a new code. Players already
          here aren't affected.
          <button className="btn btn-primary btn-sm" onClick={() => void regenerateCode()}>New code</button>
        </div>
      )}
      <div className="setup-columns">
        <section className="setup-row">
          <h2>Room code</h2>
          <div className="mp-code-row">
            <div className="mp-code num" aria-label="Room code">{formatCode(info.code)}</div>
            <button className="btn btn-sm" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
            <button className="btn btn-sm" onClick={() => void regenerateCode()} title="Players who already joined stay; new players need the new code">
              New code
            </button>
          </div>
          <ul className="mp-howto">
            <li><strong>Same Wi-Fi:</strong> they open Multiplayer → Join and pick “{setup.room.name}”, or type <code>{addr}</code>.</li>
            <li>
              <strong>Over the internet:</strong> forward TCP port <code>{info.port}</code> on your router to this computer
              {info.lanIps[0] ? <> (<code>{info.lanIps[0]}</code>)</> : null}, then give them your public IP and the code.
            </li>
            <li>Only share the code with people you want at the table.</li>
          </ul>
        </section>

        <section className="setup-row">
          <h2>
            Seats <span className="num">{seatsUsed}/{MAX_SEATS}</span>
          </h2>
          <ul className="mp-seats">
            {seats.map((s) => (
              <li key={s.id}>
                <span className="avatar" style={{ background: s.kind === "host" ? "var(--accent)" : "var(--info)" }}>
                  {s.kind === "host" ? <Icon name="spade" size="1rem" /> : s.name[0]}
                </span>
                <span className="mp-seat-name">{s.name}</span>
                <span className="muted">{s.kind === "host" ? "Host (you)" : "Player"}</span>
                {s.kind === "remote" && (
                  <button className="btn btn-sm" onClick={() => kick(s.id)} title="Remove this player. They can't rejoin this room.">
                    Kick
                  </button>
                )}
              </li>
            ))}
            {Array.from({ length: MAX_SEATS - seats.length }, (_, i) =>
              i < setup.bots ? (
                <li key={`bot${i}`} className="bot">
                  <span
                    className="avatar"
                    style={{ background: STYLE_COLORS[setup.botStyle === "mixed" ? Object.keys(BOT_PROFILES)[i % 4] : setup.botStyle] }}
                  >
                    B
                  </span>
                  <span className="mp-seat-name">Bot</span>
                  <span className="muted">{setup.botStyle === "mixed" ? "Mixed style" : BOT_PROFILES[setup.botStyle].name}</span>
                </li>
              ) : (
                <li key={`open${i}`} className="open">
                  <span className="avatar empty" />
                  <span className="muted">Open seat</span>
                </li>
              ),
            )}
          </ul>
          <div className="mp-bots">
            <span>Bots</span>
            <div className="stepper">
              <button className="step-btn" onClick={() => setBots(setup.bots - 1)} disabled={setup.bots <= 0} aria-label="Fewer bots">−</button>
              <div className="step-value"><span className="num">{setup.bots}</span></div>
              <button className="step-btn" onClick={() => setBots(setup.bots + 1)} disabled={setup.bots >= maxBots} aria-label="More bots">+</button>
            </div>
            <select value={setup.botStyle} onChange={(e) => updateSetup({ botStyle: e.target.value })} aria-label="Bot style" className="mp-input">
              <option value="mixed">Mixed styles</option>
              {Object.values(BOT_PROFILES).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </section>
      </div>

      <RoomRules room={setup.room} onChange={updateRoom} />

      <div className="field">
        <span>
          Lock room
          <div className="desc">No new players can join. Players who drop can still reconnect.</div>
        </span>
        <button className="toggle" role="switch" aria-checked={locked} aria-label="Lock room" onClick={() => setLocked(!locked)} />
      </div>

      <div className="mp-actions">
        <button className="btn" onClick={close}>Close room</button>
        <button className="menu-btn primary deal-btn" onClick={start} disabled={status !== "lobby" || seatsUsed < 2}>
          {seatsUsed < 2 ? "Waiting for players…" : <>Start game <Icon name="play" size="0.8em" /></>}
        </button>
      </div>
    </>
  );
}

function RoomRules({ room, onChange }: { room: RoomSettings; onChange: (patch: Partial<RoomSettings>) => void }) {
  const bbs = room.startingStack / room.bigBlind;
  return (
    <>
      <div className="setup-columns">
        <section className="setup-row">
          <h2>Stakes</h2>
          <div className="tile-row compact">
            {STAKES.map((s) => (
              <Tile
                key={s.bb}
                selected={room.bigBlind === s.bb}
                onClick={() => onChange({ bigBlind: s.bb, smallBlind: s.bb / 2, startingStack: bbs * s.bb })}
              >
                <span className="tile-name">{s.label}</span>
                <span className="tile-desc num">{chips(s.bb / 2)}/{chips(s.bb)}</span>
              </Tile>
            ))}
          </div>
        </section>
        <section className="setup-row">
          <h2>Starting chips</h2>
          <div className="tile-row compact">
            {STACKS.map((s) => (
              <Tile key={s.bbs} selected={bbs === s.bbs} onClick={() => onChange({ startingStack: s.bbs * room.bigBlind })}>
                <span className="tile-name">{s.label}</span>
                <span className="tile-big num">{chips(s.bbs * room.bigBlind)}</span>
              </Tile>
            ))}
          </div>
        </section>
      </div>
      <div className="setup-columns">
        <section className="setup-row">
          <h2>Turn timer</h2>
          <div className="tile-row compact">
            {TURN_TIMES.map((t) => (
              <Tile key={t} selected={room.turnSeconds === t} onClick={() => onChange({ turnSeconds: t })}>
                <span className="tile-name">{t === 0 ? "Off" : `${t}s`}</span>
              </Tile>
            ))}
          </div>
          <p className="setup-hint">When time runs out, the player checks if they can, otherwise folds.</p>
        </section>
        <section className="setup-row">
          <h2>Learning helpers</h2>
          <div className="tile-row compact">
            <Tile selected={room.helpers} onClick={() => onChange({ helpers: true })}>
              <span className="tile-icon"><Icon name="coach" /></span>
              <span className="tile-name">Allowed</span>
            </Tile>
            <Tile selected={!room.helpers} onClick={() => onChange({ helpers: false })}>
              <span className="tile-icon"><Icon name="cards" /></span>
              <span className="tile-name">Off</span>
            </Tile>
          </div>
          <p className="setup-hint">
            Coach, win chance and hints for everyone, or plain poker. It's a table rule; helpers never see anyone else's cards.
          </p>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Joining

function JoinForm() {
  const { prefs, updatePrefs, rooms, discovering, discover, join, status, error, endReason } = useClientStore();
  const [code, setCode] = useState("");
  useEffect(() => {
    void discover();
  }, [discover]);
  const connecting = status === "connecting";
  const canJoin = !connecting && prefs.name.trim() && prefs.address.trim() && code.replace(/[\s-]/g, "").length === 8;
  const ended =
    status === "ended" && (endReason === "kicked" ? "The host removed you from the room." : endReason === "hostClosed" ? "The host closed the room." : "Lost the connection to the host.");

  return (
    <form
      className="mp-join"
      onSubmit={(e) => {
        e.preventDefault();
        if (canJoin) void join(prefs.address.trim(), code);
      }}
    >
      <section className="setup-row">
        <h2>Your name</h2>
        <input className="mp-input" value={prefs.name} maxLength={16} onChange={(e) => updatePrefs({ name: e.target.value })} aria-label="Your name" />
      </section>

      <section className="setup-row">
        <h2>
          Rooms on your network
          <button type="button" className="btn btn-sm" style={{ marginLeft: "0.8rem" }} onClick={() => void discover()} disabled={discovering}>
            {discovering ? "Looking…" : "Refresh"}
          </button>
        </h2>
        {rooms.length === 0 ? (
          <p className="setup-hint">{discovering ? "Looking for rooms…" : "No rooms found nearby. You can still type the host's address below."}</p>
        ) : (
          <div className="tile-row slim">
            {rooms.map((r) => (
              <Tile key={r.address} selected={prefs.address === r.address} onClick={() => updatePrefs({ address: r.address })}>
                <span className="tile-icon"><Icon name="spade" /></span>
                <span>
                  <span className="tile-name">{r.name}</span>
                  <span className="tile-desc num" style={{ display: "block" }}>{r.seats}/{r.max} seats · {r.address}</span>
                </span>
              </Tile>
            ))}
          </div>
        )}
      </section>

      <div className="setup-columns">
        <section className="setup-row">
          <h2>Host address</h2>
          <input
            className="mp-input num"
            value={prefs.address}
            placeholder="192.168.1.20 or 203.0.113.7:47820"
            onChange={(e) => updatePrefs({ address: e.target.value })}
            aria-label="Host address"
            spellCheck={false}
          />
        </section>
        <section className="setup-row">
          <h2>Room code</h2>
          <input
            className="mp-input mp-code-input num"
            value={code}
            placeholder="XXXX-XXXX"
            maxLength={12}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Room code"
          />
        </section>
      </div>
      {(error || ended) && <p className="mp-error" role="alert">{error ?? ended}</p>}
      <button type="submit" className="menu-btn primary deal-btn" disabled={!canJoin}>
        {connecting ? "Connecting…" : <>Join <Icon name="play" size="0.8em" /></>}
      </button>
    </form>
  );
}

function JoinLobby() {
  const { room, seats, seatId, leave } = useClientStore();
  return (
    <>
      <p className="text-2">
        Connected to <strong>{room?.name}</strong>. Waiting for the host to start the game…
      </p>
      {room && (
        <p className="text-2 num">
          Blinds {chips(room.smallBlind)}/{chips(room.bigBlind)} · {chips(room.startingStack)} chips ·{" "}
          {room.turnSeconds ? `${room.turnSeconds}s turns` : "no turn timer"} · helpers {room.helpers ? "allowed" : "off"}
        </p>
      )}
      <section className="setup-row">
        <h2>
          Seats <span className="num">{seats.length}/{MAX_SEATS}</span>
        </h2>
        <ul className="mp-seats">
          {seats.map((s) => (
            <li key={s.id}>
              <span
                className="avatar"
                style={{ background: s.kind === "bot" ? STYLE_COLORS[s.botProfile ?? "tag"] : s.kind === "host" ? "var(--accent)" : "var(--info)" }}
              >
                {s.name[0]}
              </span>
              <span className="mp-seat-name">{s.name}</span>
              <span className="muted">{s.id === seatId ? "You" : s.kind === "host" ? "Host" : s.kind === "bot" ? "Bot" : "Player"}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="mp-actions">
        <button className="btn" onClick={leave}>Leave</button>
      </div>
    </>
  );
}
