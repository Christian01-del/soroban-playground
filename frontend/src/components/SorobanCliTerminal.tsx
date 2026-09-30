"use client";

import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Terminal, Play, RotateCcw, HelpCircle, Key, Cpu } from "lucide-react";

interface HistoryEntry {
  id: string;
  command: string;
  output: string | React.ReactNode;
  type: "command" | "info" | "error" | "success";
  timestamp: string;
}

const COMMAND_SUGGESTIONS = [
  "soroban contract build",
  "soroban contract deploy --network testnet",
  "soroban contract invoke --id C123... --fn hello",
  "soroban contract read --id C123...",
  "soroban contract inspect --wasm ./contract.wasm",
  "soroban keys generate default",
  "soroban keys list",
  "soroban --version",
  "help",
  "clear",
];

export function SorobanCliTerminal() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([
    {
      id: "init",
      command: "",
      output:
        "Soroban CLI Terminal Emulator v21.0.0. Type 'help' or press Tab for command autocompletion.",
      type: "info",
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] =
    useState<number>(0);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const handleInputChange = (val: string) => {
    setInput(val);
    if (val.trim()) {
      const filtered = COMMAND_SUGGESTIONS.filter((cmd) =>
        cmd.toLowerCase().startsWith(val.toLowerCase()),
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setSelectedSuggestionIndex(0);
    } else {
      setShowSuggestions(false);
    }
  };

  const executeCommand = (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    const time = new Date().toLocaleTimeString();
    const newHistoryEntry: HistoryEntry = {
      id: Math.random().toString(36).substring(7),
      command: trimmed,
      output: "",
      type: "command",
      timestamp: time,
    };

    setCommandHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setInput("");
    setShowSuggestions(false);

    if (trimmed === "clear") {
      setHistory([]);
      return;
    }

    if (trimmed === "help" || trimmed === "soroban --help") {
      newHistoryEntry.output = (
        <div className="space-y-1.5 text-gray-300">
          <p className="text-cyan-400 font-semibold">
            Available Soroban CLI Commands:
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-300 text-xs">
            <li>
              <code className="text-emerald-400">soroban contract build</code> -
              Compile contract to WebAssembly (.wasm)
            </li>
            <li>
              <code className="text-emerald-400">
                soroban contract deploy --network &lt;network&gt;
              </code>{" "}
              - Deploy WASM artifact to network
            </li>
            <li>
              <code className="text-emerald-400">
                soroban contract invoke --id &lt;id&gt; --fn &lt;fn&gt;
              </code>{" "}
              - Call contract function
            </li>
            <li>
              <code className="text-emerald-400">
                soroban contract read --id &lt;id&gt;
              </code>{" "}
              - Read contract ledger state
            </li>
            <li>
              <code className="text-emerald-400">
                soroban contract inspect --wasm &lt;file&gt;
              </code>{" "}
              - Inspect WASM interface spec
            </li>
            <li>
              <code className="text-emerald-400">
                soroban keys generate &lt;name&gt;
              </code>{" "}
              - Generate new keypair
            </li>
            <li>
              <code className="text-emerald-400">soroban keys list</code> - View
              configured identity keys
            </li>
            <li>
              <code className="text-emerald-400">clear</code> - Clear terminal
              screen
            </li>
          </ul>
        </div>
      );
      newHistoryEntry.type = "info";
    } else if (
      trimmed === "soroban --version" ||
      trimmed === "soroban version"
    ) {
      newHistoryEntry.output = "soroban 21.0.0 (stellar-cli release build)";
      newHistoryEntry.type = "info";
    } else if (trimmed.startsWith("soroban contract build")) {
      newHistoryEntry.output = (
        <div className="text-emerald-400">
          <p>
            Compiling workspace contracts with cargo build --target
            wasm32-unknown-unknown --release...
          </p>
          <p className="text-slate-400">
            Finished release [optimized] target(s) in 1.42s
          </p>
          <p className="text-cyan-300">
            WASM Output:
            target/wasm32-unknown-unknown/release/soroban_contract.wasm (size:
            42.1 KB)
          </p>
        </div>
      );
      newHistoryEntry.type = "success";
    } else if (trimmed.startsWith("soroban contract deploy")) {
      const mockContractId =
        "CC" +
        Math.random().toString(36).substring(2, 14).toUpperCase() +
        "EXAMPLE";
      newHistoryEntry.output = (
        <div className="text-emerald-400">
          <p>
            Connecting to Stellar Testnet RPC
            (https://soroban-testnet.stellar.org)...
          </p>
          <p>Signing transaction with identity key &apos;default&apos;...</p>
          <p>Contract deployed successfully!</p>
          <p className="text-cyan-300 font-mono">
            Contract ID: {mockContractId}
          </p>
        </div>
      );
      newHistoryEntry.type = "success";
    } else if (trimmed.startsWith("soroban contract invoke")) {
      newHistoryEntry.output = (
        <div className="text-slate-200">
          <p className="text-cyan-400">Invoking contract method...</p>
          <pre className="bg-slate-900 p-2 rounded text-emerald-400 text-xs mt-1">
            {`"Hello, Soroban CLI!"`}
          </pre>
        </div>
      );
      newHistoryEntry.type = "success";
    } else if (trimmed.startsWith("soroban keys generate")) {
      const parts = trimmed.split(" ");
      const keyName = parts[3] || "default";
      const pubKey =
        "G" +
        Math.random().toString(36).substring(2, 14).toUpperCase() +
        "MOCKKEY";
      newHistoryEntry.output = (
        <div className="text-slate-200">
          <p className="text-emerald-400">
            Generated keypair &apos;{keyName}&apos;:
          </p>
          <p className="font-mono text-cyan-300">Public Key: {pubKey}</p>
          <p className="text-amber-400 text-xs">
            Secret key saved securely to local sandbox keyring.
          </p>
        </div>
      );
      newHistoryEntry.type = "success";
    } else if (trimmed === "soroban keys list") {
      newHistoryEntry.output = (
        <div className="text-slate-300 font-mono text-xs space-y-1">
          <p className="text-cyan-400 font-sans">Configured Identities:</p>
          <p>• default: GBX73K9...42L (Testnet)</p>
          <p>• alice: GD83K2M...19P (Testnet)</p>
          <p>• bob: GC92L11...88X (Testnet)</p>
        </div>
      );
      newHistoryEntry.type = "info";
    } else if (trimmed.startsWith("soroban")) {
      newHistoryEntry.output = `Executed: '${trimmed}'. Request completed cleanly.`;
      newHistoryEntry.type = "info";
    } else {
      newHistoryEntry.output = `command not found: ${trimmed}. Type 'help' for available CLI commands.`;
      newHistoryEntry.type = "error";
    }

    setHistory((prev) => [...prev, newHistoryEntry]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (showSuggestions && suggestions.length > 0) {
        const selected = suggestions[selectedSuggestionIndex] || suggestions[0];
        executeCommand(selected);
      } else {
        executeCommand(input);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (suggestions.length > 0) {
        setInput(suggestions[selectedSuggestionIndex] || suggestions[0]);
        setShowSuggestions(false);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showSuggestions) {
        setSelectedSuggestionIndex((prev) => Math.max(0, prev - 1));
      } else if (commandHistory.length > 0) {
        const nextIndex =
          historyIndex < commandHistory.length - 1
            ? historyIndex + 1
            : historyIndex;
        setHistoryIndex(nextIndex);
        setInput(commandHistory[commandHistory.length - 1 - nextIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (showSuggestions) {
        setSelectedSuggestionIndex((prev) =>
          Math.min(suggestions.length - 1, prev + 1),
        );
      } else if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setInput(commandHistory[commandHistory.length - 1 - nextIndex] || "");
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput("");
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="flex flex-col h-72 bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow-inner text-xs font-mono">
      {/* Header presets bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800 text-gray-300">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-cyan-400" />
          <span className="font-semibold text-gray-200">
            Soroban CLI Terminal
          </span>
        </div>

        {/* Quick Execution Presets */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => executeCommand("soroban contract build")}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 px-2 py-1 rounded transition text-[11px]"
          >
            <Cpu size={12} />
            <span>Build</span>
          </button>
          <button
            type="button"
            onClick={() => executeCommand("soroban keys generate default")}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-amber-300 px-2 py-1 rounded transition text-[11px]"
          >
            <Key size={12} />
            <span>Gen Keys</span>
          </button>
          <button
            type="button"
            onClick={() => executeCommand("help")}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition text-[11px]"
          >
            <HelpCircle size={12} />
            <span>Help</span>
          </button>
          <button
            type="button"
            onClick={() => executeCommand("clear")}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-rose-300 px-2 py-1 rounded transition text-[11px]"
          >
            <RotateCcw size={12} />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Terminal Output Area */}
      <div
        className="flex-1 overflow-y-auto p-3 space-y-2 text-gray-200 bg-gray-950/90"
        onClick={() => inputRef.current?.focus()}
      >
        {history.map((entry) => (
          <div key={entry.id} className="space-y-0.5">
            {entry.command && (
              <div className="flex items-center gap-2 text-slate-400">
                <span className="text-emerald-400 font-semibold">
                  soroban-cli$
                </span>
                <span className="text-cyan-200">{entry.command}</span>
                <span className="text-[10px] text-gray-600 ml-auto">
                  {entry.timestamp}
                </span>
              </div>
            )}
            <div
              className={`pl-4 ${
                entry.type === "error"
                  ? "text-rose-400"
                  : entry.type === "success"
                    ? "text-emerald-300"
                    : "text-slate-300"
              }`}
            >
              {entry.output}
            </div>
          </div>
        ))}
        <div ref={terminalEndRef} />
      </div>

      {/* Interactive Input with Auto-Suggestions Popup */}
      <div className="relative border-t border-gray-800 bg-gray-900 px-3 py-2 flex items-center gap-2">
        <span className="text-emerald-400 font-semibold select-none">
          soroban-cli$
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type soroban CLI command or press Tab for autocompletion..."
          className="flex-1 bg-transparent text-cyan-200 outline-none placeholder-gray-600 font-mono text-xs"
        />

        {/* Suggestions Popup */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute bottom-full left-12 mb-1 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-20">
            <div className="px-2 py-1 bg-gray-800 text-[10px] text-slate-400 uppercase tracking-wider font-semibold border-b border-gray-700">
              Suggestions (Press Tab or Enter to select)
            </div>
            {suggestions.map((sug, idx) => (
              <div
                key={sug}
                onClick={() => executeCommand(sug)}
                className={`px-3 py-1.5 cursor-pointer text-xs transition ${
                  idx === selectedSuggestionIndex
                    ? "bg-slate-800 text-cyan-300 font-semibold"
                    : "text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                {sug}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SorobanCliTerminal;
