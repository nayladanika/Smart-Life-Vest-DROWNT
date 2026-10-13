import React from 'react';
import StatsBar from './StatsBar';
import SignalCharts from './SignalCharts';
import LiveMap from './LiveMap';
import MLDiagnostics from './MLDiagnostics';
import TelemetryLog from './TelemetryLog';
import SimulatorControls from './SimulatorControls';
import PingerPanel from "./PingerPanel"; 

export default function OverviewPage({
  telemetry,
  breadcrumbs,
  logs,
  onClearLogs,
  connectionState,
  isSimulatorActive,
  currentScenario,
  onSelectScenario,
  onSetPresetLocation,
  theme
}) {
  return (
    <div className="overview-page-layout">
      {/* 1. Top KPI Metrics HUD */}
      <StatsBar telemetry={telemetry} />

      {/* 2. Real-time Filtered PPG Waveform & 2-Minute Trend Charts */}
      <SignalCharts
        telemetry={telemetry}
        isConnected={connectionState?.connected}
        isSimulatorActive={isSimulatorActive}
      />

      {/* 3. Demo Simulator Controls (Active when user clicks Demo Simulator) */}
      {isSimulatorActive && (
        <SimulatorControls
          currentScenario={currentScenario}
          onSelectScenario={onSelectScenario}
        />
      )}

      {/* 4. Split Grid: Live Map (Left) & Diagnostics / Log (Right) */}
      <div className="overview-split-grid">
        {/* Left Column: Live Tactical Map */}
        <LiveMap
          telemetry={telemetry}
          breadcrumbs={breadcrumbs}
          onSetPresetLocation={onSetPresetLocation}
          theme={theme}
        />

        {/* Right Column: ML Engine Breakdown & Real-Time Log */}
        <div className="overview-right-col">
          <MLDiagnostics telemetry={telemetry} />
          <TelemetryLog logs={logs} onClearLogs={onClearLogs} />
        </div>
      </div>
    </div>
  );
}
