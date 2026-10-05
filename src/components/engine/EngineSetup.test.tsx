import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EngineSetup from './EngineSetup';
import { useEngineStore } from '../../core/store';
import { getForgeState, forgeActions } from '../../store/useForgeStore';
import { useAppStore } from '../../store/useAppStore';
import type { Blueprint } from '../../types';
import { normalizeBlueprint } from '../../lib/normalizeBlueprint';

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, onClick }: { children?: React.ReactNode; className?: string; onClick?: () => void }) => (
      <div className={className} onClick={onClick}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const testBlueprint = normalizeBlueprint({
  title: 'Generic Enclosure',
  contentScale: 2,
  contentLevelDescription: 'Standard horror',
  globalPremise: 'A generic test premise.',
  environmentalRules: 'Rules are strictly enforced.',
  cast: [
    {
      id: 'char-1',
      name: 'Mortal One',
      role: 'Specialist',
      description: 'First generic mortal subject.',
      personality: 'Cautious',
      goals: 'Observe the enclosure',
      traits: ['Analytical'],
      isEntity: false,
      presenceDisposition: { kind: 'AT_NODE', nodeId: 'CHAMBER_01' },
    },
    {
      id: 'char-2',
      name: 'Mortal Two',
      role: 'Operator',
      description: 'Second generic mortal subject.',
      personality: 'Bold',
      goals: 'Inspect the systems',
      traits: ['Audacious'],
      isEntity: false,
      presenceDisposition: { kind: 'AT_NODE', nodeId: 'CHAMBER_02' },
    },
    {
      id: 'entity-1',
      name: 'Entity One',
      role: 'Opposition',
      description: 'Generic entity presence.',
      personality: 'Predatory',
      goals: 'Oppose the mortals',
      traits: ['Incorporeal'],
      isEntity: true,
    },
  ],
  setting: {
    location: 'Chamber 01',
    timePeriod: 'Present',
    atmosphere: 'Sterile',
  },
  narrativeRules: {
    incitingIncident: 'The system initialized.',
  },
  topology: {
    nodes: ['CHAMBER_01', 'CHAMBER_02'],
    connections: [],
    startingNodeId: 'CHAMBER_01',
  },
});

async function uploadBlueprint(container: HTMLElement, bp: Blueprint) {
  const file = new File([JSON.stringify(bp)], 'blueprint.json', {
    type: 'application/json',
  });
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(fileInput).toBeTruthy();

  const originalFileReader = window.FileReader;
  class MockFileReader {
    onload: ((ev: ProgressEvent<FileReader> | { target: { result: string } }) => void) | null = null;
    readAsText() {
      if (this.onload) {
        this.onload({ target: { result: JSON.stringify(bp) } });
      }
    }
  }
  window.FileReader = MockFileReader as unknown as typeof FileReader;

  await act(async () => {
    Object.defineProperty(fileInput, 'files', {
      value: [file],
      writable: true,
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });

  window.FileReader = originalFileReader;
}

describe('EngineSetup explicit cast binding', () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    useEngineStore.getState().resetEngine();
    forgeActions.setActiveCharacterId(null);
    forgeActions.clearForgeInputs();
    useAppStore.getState().resetSession();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
      container = null;
      root = null;
    }
  });

  it('renders selectable cast cards and allows selecting non-default mortal for protagonist', async () => {
    await act(async () => {
      root?.render(<EngineSetup />);
    });

    await uploadBlueprint(container!, testBlueprint);

    // Verify title is rendered
    expect(container!.textContent).toContain('Generic Enclosure');

    const buttons = Array.from(container!.querySelectorAll('button'));
    const firstMortalBtn = buttons.find((b) => b.textContent?.includes('Mortal One')) as HTMLButtonElement;
    const secondMortalBtn = buttons.find((b) => b.textContent?.includes('Mortal Two')) as HTMLButtonElement;
    const entityBtn = buttons.find((b) => b.textContent?.includes('Entity One')) as HTMLButtonElement;

    expect(firstMortalBtn).toBeTruthy();
    expect(secondMortalBtn).toBeTruthy();
    expect(entityBtn).toBeTruthy();

    expect(firstMortalBtn.disabled).toBe(false);
    expect(secondMortalBtn.disabled).toBe(false);
    expect(entityBtn.disabled).toBe(false); // Universal cast eligibility

    // Select the non-first eligible mortal.
    await act(async () => {
      secondMortalBtn.click();
    });

    expect(getForgeState().activeCharacterId).toBe('char-2');

    // Click start simulation
    const startBtn = buttons.find((b) => b.textContent?.includes('Initialize Neural Link')) as HTMLButtonElement;
    expect(startBtn).toBeTruthy();

    await act(async () => {
      startBtn.click();
    });

    const gameState = useEngineStore.getState().gameState;
    expect(gameState?.player_role).toBe('protagonist');
    expect(gameState?.player_character_id).toBe('char-2');
    expect(gameState?.perspective_mode).toBe('embodied');
    expect(useAppStore.getState().currentNodeId).toBe('CHAMBER_02');
  });

  it('handles cast card selection when switching between roles', async () => {
    await act(async () => {
      root?.render(<EngineSetup />);
    });

    await uploadBlueprint(container!, testBlueprint);

    const buttons = Array.from(container!.querySelectorAll('button'));
    const antagonistRoleBtn = buttons.find((b) => b.textContent?.includes('Antagonist')) as HTMLButtonElement;
    expect(antagonistRoleBtn).toBeTruthy();

    await act(async () => {
      antagonistRoleBtn.click();
    });

    const refreshedButtons = Array.from(container!.querySelectorAll('button'));
    const firstMortalBtn = refreshedButtons.find((b) => b.textContent?.includes('Mortal One')) as HTMLButtonElement;
    const entityBtn = refreshedButtons.find((b) => b.textContent?.includes('Entity One')) as HTMLButtonElement;

    expect(firstMortalBtn.disabled).toBe(false);
    expect(entityBtn.disabled).toBe(false);

    // Select the entity.
    await act(async () => {
      entityBtn.click();
    });
    expect(getForgeState().activeCharacterId).toBe('entity-1');

    // Verify Director role button is disabled
    const directorRoleBtn = refreshedButtons.find((b) => b.textContent?.includes('Director')) as HTMLButtonElement;
    expect(directorRoleBtn).toBeTruthy();
    expect(directorRoleBtn.disabled).toBe(true);

    const antagonistStartBtn = Array.from(container!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Initialize Neural Link')
    ) as HTMLButtonElement;
    expect(antagonistStartBtn).toBeTruthy();

    await act(async () => {
      antagonistStartBtn.click();
    });

    const antagonistGameState = useEngineStore.getState().gameState;
    expect(antagonistGameState?.player_role).toBe('villain');
    expect(antagonistGameState?.player_character_id).toBe('entity-1');
    expect(antagonistGameState?.perspective_mode).toBe('embodied');
  });

  it('renders director card disabled with not-yet-built badge and reason when director is unavailable', async () => {
    await act(async () => {
      root?.render(<EngineSetup />);
    });

    await uploadBlueprint(container!, testBlueprint);

    const buttons = Array.from(container!.querySelectorAll('button'));
    const directorRoleBtn = buttons.find((b) => b.textContent?.includes('Director')) as HTMLButtonElement;
    expect(directorRoleBtn).toBeTruthy();
    expect(directorRoleBtn.disabled).toBe(true);
    expect(directorRoleBtn.textContent).toContain('Not yet built');
    expect(directorRoleBtn.textContent).toContain('Director mode is not yet built.');
  });

  it('renders villain card with select-below guidance when available and no character is chosen', async () => {
    await act(async () => {
      root?.render(<EngineSetup />);
    });

    await uploadBlueprint(container!, testBlueprint);

    // Ensure no character is selected
    await act(async () => {
      forgeActions.setActiveCharacterId(null);
    });

    const buttons = Array.from(container!.querySelectorAll('button'));
    const villainRoleBtn = buttons.find((b) => b.textContent?.includes('Villain')) as HTMLButtonElement;
    expect(villainRoleBtn).toBeTruthy();
    expect(villainRoleBtn.disabled).toBe(false);
    expect(villainRoleBtn.textContent).toContain('Select a villain below');
  });

  it('allows clicking an already selected cast member to toggle/clear selection', async () => {
    await act(async () => {
      root?.render(<EngineSetup />);
    });

    await uploadBlueprint(container!, testBlueprint);

    const buttons = Array.from(container!.querySelectorAll('button'));
    const secondMortalBtn = buttons.find((b) => b.textContent?.includes('Mortal Two')) as HTMLButtonElement;

    await act(async () => {
      secondMortalBtn.click();
    });
    expect(getForgeState().activeCharacterId).toBe('char-2');

    // Click again to toggle off
    await act(async () => {
      secondMortalBtn.click();
    });
    expect(getForgeState().activeCharacterId).toBeNull();
  });
});
