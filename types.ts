export enum AppState {
  INTRO = 'INTRO',
  CAMERA_READY = 'CAMERA_READY',
  ANALYZING = 'ANALYZING',
  REPAIR_GUIDE = 'REPAIR_GUIDE',
  VERIFYING = 'VERIFYING',
  INSPECTING = 'INSPECTING', // New state for Component Inspector
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface Coordinates {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface VisualCue {
  type: 'box' | 'arrow' | 'point' | 'none';
  coordinates: Coordinates;
  label?: string;
  direction?: string; // e.g., "clockwise", "up"
}

export interface RepairStep {
  id: number;
  title: string;
  instruction: string;
  visualCue: VisualCue;
  toolNeeded?: string;
  safetyWarning?: string; // New field for safety alerts
}

export interface RepairPlan {
  objectName: string;
  issueDiagnosis: string;
  steps: RepairStep[];
}

export interface ComponentInfo {
  name: string;
  function: string;
  status: 'Good' | 'Damaged' | 'Unknown';
  details: string;
}

// For raw API response parsing
export interface GeminiRepairResponse {
  object_name: string;
  issue_diagnosis: string;
  steps: {
    title: string;
    instruction: string;
    tool_needed?: string;
    safety_warning?: string;
    visual_cue: {
      type: string;
      ymin: number;
      xmin: number;
      ymax: number;
      xmax: number;
      label?: string;
      direction?: string;
    }
  }[];
}