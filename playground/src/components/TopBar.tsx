import { Toolbar } from './Toolbar';

export function TopBar({
  onOpen,
  hasScene,
  shEnabled,
  onShChange,
  turntable,
  onTurntableChange,
  hoverEnabled,
  onHoverChange,
  cameraControlMode,
  onCameraControlModeChange,
  sortMode,
  onSortModeChange,
}: {
  onOpen: () => void;
  hasScene: boolean;
  shEnabled: boolean;
  onShChange: (v: boolean) => void;
  turntable: boolean;
  onTurntableChange: (v: boolean) => void;
  hoverEnabled: boolean;
  onHoverChange: (v: boolean) => void;
  cameraControlMode: 'orbit' | 'fly';
  onCameraControlModeChange: (v: 'orbit' | 'fly') => void;
  sortMode: 'cpu' | 'gpu' | 'gpu-subgroup' | 'gpu-unstable';
  onSortModeChange: (v: 'cpu' | 'gpu' | 'gpu-subgroup' | 'gpu-unstable') => void;
}) {
  return (
    <header className="absolute top-0 left-0 right-0 z-10 bg-transparent pointer-events-none [&>*]:pointer-events-auto">
      <Toolbar
        onOpen={onOpen}
        hasScene={hasScene}
        shEnabled={shEnabled}
        onShChange={onShChange}
        turntable={turntable}
        onTurntableChange={onTurntableChange}
        hoverEnabled={hoverEnabled}
        onHoverChange={onHoverChange}
        cameraControlMode={cameraControlMode}
        onCameraControlModeChange={onCameraControlModeChange}
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
      />
    </header>
  );
}
