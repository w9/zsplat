import { Icon } from '@mdi/react';
import { mdiAirplane, mdiCursorDefaultClick, mdiFolderOpen, mdiRotate360, mdiSphere } from '@mdi/js';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type SortMode = 'cpu' | 'gpu' | 'gpu-subgroup' | 'gpu-unstable';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'gpu-subgroup', label: 'GPU Subgroup Optimized' },
  { value: 'gpu', label: 'GPU Portable' },
  { value: 'gpu-unstable', label: 'GPU Unstable' },
  { value: 'cpu', label: 'CPU' },
];

const iconSize = '14px';

export function Toolbar({
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
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
}) {
  return (
    <div className="p-2.5 px-4 flex flex-wrap items-center gap-3 shrink-0">
      <span className="font-bold text-base tracking-tight">ZSplat</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onOpen}
      >
        <Icon path={mdiFolderOpen} size={iconSize} />
        Open PLY/SPZ
      </Button>
      {hasScene && (
        <Toggle
          pressed={shEnabled}
          onPressedChange={onShChange}
          variant="outline"
          size="sm"
          title="Spherical harmonics"
        >
          <Icon path={mdiSphere} size={iconSize} />
          Spherical harmonics
        </Toggle>
      )}
      {hasScene && (
        <Toggle
          pressed={turntable}
          onPressedChange={onTurntableChange}
          variant="outline"
          size="sm"
          title="Turntable"
        >
          <Icon path={mdiRotate360} size={iconSize} />
          Turntable
        </Toggle>
      )}
      {hasScene && (
        <Toggle
          pressed={hoverEnabled}
          onPressedChange={onHoverChange}
          variant="outline"
          size="sm"
          title="Hover"
        >
          <Icon path={mdiCursorDefaultClick} size={iconSize} />
          Hover
        </Toggle>
      )}
      {hasScene && (
        <Toggle
          pressed={cameraControlMode === 'fly'}
          onPressedChange={(p) => onCameraControlModeChange(p ? 'fly' : 'orbit')}
          variant="outline"
          size="sm"
          title={cameraControlMode === 'fly' ? 'Fly (left drag: look around)' : 'Orbit (left drag: rotate around target)'}
        >
          <Icon path={mdiAirplane} size={iconSize} />
          Fly
        </Toggle>
      )}
      {hasScene && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={sortMode}
          onValueChange={(v) => { if (v) onSortModeChange(v as SortMode); }}
        >
          {SORT_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value} title={opt.label}>
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </div>
  );
}
