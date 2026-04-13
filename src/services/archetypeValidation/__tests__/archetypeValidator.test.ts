import {
  ArchetypeValidator,
  RosterAdapter,
  filterWarningsForSquad,
} from '../archetypeValidator';
import {
  ArchetypeConfig,
  ArchetypeDefinition,
  LeaderArchetypeMapping,
} from '../../../types/archetypeTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal roster adapter from explicit sets */
function makeRoster(opts: {
  units?: string[];
  zetas?: Record<string, string[]>;
  omicrons?: Record<string, string[]>;
  relics?: Record<string, number>;
}): RosterAdapter {
  const units = new Set(opts.units ?? []);
  const zetas: Record<string, string[]> = opts.zetas ?? {};
  const omicrons: Record<string, string[]> = opts.omicrons ?? {};
  const relics: Record<string, number> = opts.relics ?? {};

  return {
    hasUnit: (id) => units.has(id),
    getUnit: () => undefined,
    hasZeta: (unitId, abilityId) => (zetas[unitId] ?? []).includes(abilityId),
    hasOmicron: (unitId, abilityId) => (omicrons[unitId] ?? []).includes(abilityId),
    getRelicLevel: (unitId) => relics[unitId] ?? null,
  };
}

/** Minimal archetype definition factory */
function makeArchetype(overrides: Partial<ArchetypeDefinition> & { id: string }): ArchetypeDefinition {
  return {
    displayName: overrides.id,
    description: 'Test archetype',
    modes: ['GAC_5v5'],
    composition: { requiredUnits: [], minimumRelics: [] },
    requiredAbilities: [],
    optionalAbilities: [],
    warnings: [],
    ...overrides,
  };
}

/** Minimal ArchetypeConfig factory */
function makeConfig(archetypes: ArchetypeDefinition[]): ArchetypeConfig {
  return { version: '1', lastUpdated: '2026-01-01', archetypes };
}

// ---------------------------------------------------------------------------
// validateArchetype — viable=true when all required abilities present
// ---------------------------------------------------------------------------

describe('ArchetypeValidator.validateArchetype', () => {
  it('returns viable=true when all required abilities are present', () => {
    const archetype = makeArchetype({
      id: 'TEST_ARCH',
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'zeta_UNIT_A_01',
          abilityType: 'zeta',
          reason: 'Key zeta',
        },
      ],
    });

    const validator = new ArchetypeValidator(makeConfig([archetype]));
    const roster = makeRoster({
      units: ['UNIT_A'],
      zetas: { UNIT_A: ['zeta_UNIT_A_01'] },
    });

    const result = validator.validateArchetype(roster, 'TEST_ARCH', 'GAC_5v5');

    expect(result.viable).toBe(true);
    expect(result.confidence).toBe(100);
    expect(result.missingRequired).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // viable=false when required abilities missing
  // -------------------------------------------------------------------------

  it('returns viable=false when a required ability is missing', () => {
    const archetype = makeArchetype({
      id: 'TEST_ARCH',
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'zeta_UNIT_A_01',
          abilityType: 'zeta',
          reason: 'Key zeta',
        },
      ],
    });

    const validator = new ArchetypeValidator(makeConfig([archetype]));
    // Unit exists but zeta is not applied
    const roster = makeRoster({ units: ['UNIT_A'] });

    const result = validator.validateArchetype(roster, 'TEST_ARCH', 'GAC_5v5');

    expect(result.viable).toBe(false);
    expect(result.missingRequired).toHaveLength(1);
    expect(result.missingRequired![0].abilityId).toBe('zeta_UNIT_A_01');
  });

  // -------------------------------------------------------------------------
  // Confidence calculation with missing optional abilities
  // -------------------------------------------------------------------------

  it('calculates correct confidence when optional abilities are missing', () => {
    const archetype = makeArchetype({
      id: 'TEST_ARCH',
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'zeta_UNIT_A_01',
          abilityType: 'zeta',
          reason: 'Key zeta',
        },
      ],
      optionalAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'omi_UNIT_A_02',
          abilityType: 'omicron',
          confidenceWeight: 0.20, // -20% if missing
          reason: 'Nice-to-have omi',
        },
      ],
    });

    const validator = new ArchetypeValidator(makeConfig([archetype]));
    const roster = makeRoster({
      units: ['UNIT_A'],
      zetas: { UNIT_A: ['zeta_UNIT_A_01'] },
      // omicron NOT applied
    });

    const result = validator.validateArchetype(roster, 'TEST_ARCH', 'GAC_5v5');

    expect(result.viable).toBe(true);
    expect(result.confidence).toBe(80);
    expect(result.missingOptional).toHaveLength(1);
    expect(result.missingOptional![0].confidenceImpact).toBe(20);
  });

  // -------------------------------------------------------------------------
  // Mode gate: required ability is skipped when mode doesn't match
  // -------------------------------------------------------------------------

  it('skips a mode-gated required ability and adds a note when mode does not match', () => {
    const archetype = makeArchetype({
      id: 'TEST_ARCH',
      modes: ['GAC_5v5', 'GAC_3v3'],
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'omi_UNIT_A_gac',
          abilityType: 'omicron',
          modeGates: ['GAC_5v5'], // only required for 5v5
          reason: '5v5-only omi',
        },
      ],
    });

    const validator = new ArchetypeValidator(makeConfig([archetype]));
    // Roster does NOT have the omicron — should be fine in 3v3
    const roster = makeRoster({ units: ['UNIT_A'] });

    const result = validator.validateArchetype(roster, 'TEST_ARCH', 'GAC_3v3');

    // Should be viable because the gated requirement was skipped
    expect(result.viable).toBe(true);
    // A note should be added explaining the gate
    expect(result.notes).toBeDefined();
    expect(result.notes!.some(n => n.includes('GAC_5v5'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Inheritance: child inherits parent's required abilities
  // -------------------------------------------------------------------------

  it('child archetype inherits required abilities from parent', () => {
    const parent = makeArchetype({
      id: 'PARENT_ARCH',
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'zeta_UNIT_A_01',
          abilityType: 'zeta',
          reason: 'Parent required zeta',
        },
      ],
    });

    const child = makeArchetype({
      id: 'CHILD_ARCH',
      extends: 'PARENT_ARCH',
      composition: { requiredUnits: ['UNIT_B'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_B',
          abilityId: 'zeta_UNIT_B_01',
          abilityType: 'zeta',
          reason: 'Child required zeta',
        },
      ],
    });

    const validator = new ArchetypeValidator(makeConfig([parent, child]));

    // Roster has UNIT_B's zeta but NOT UNIT_A's — should be missing parent's requirement
    const rosterMissingParent = makeRoster({
      units: ['UNIT_A', 'UNIT_B'],
      zetas: { UNIT_B: ['zeta_UNIT_B_01'] },
    });

    const result = validator.validateArchetype(rosterMissingParent, 'CHILD_ARCH', 'GAC_5v5');

    expect(result.viable).toBe(false);
    expect(result.missingRequired!.some(m => m.abilityId === 'zeta_UNIT_A_01')).toBe(true);
  });

  it('child archetype is fully viable when both parent and child requirements are met', () => {
    const parent = makeArchetype({
      id: 'PARENT_ARCH',
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_A',
          abilityId: 'zeta_UNIT_A_01',
          abilityType: 'zeta',
          reason: 'Parent required zeta',
        },
      ],
    });

    const child = makeArchetype({
      id: 'CHILD_ARCH',
      extends: 'PARENT_ARCH',
      composition: { requiredUnits: ['UNIT_B'], minimumRelics: [] },
      requiredAbilities: [
        {
          unitBaseId: 'UNIT_B',
          abilityId: 'zeta_UNIT_B_01',
          abilityType: 'zeta',
          reason: 'Child required zeta',
        },
      ],
    });

    const validator = new ArchetypeValidator(makeConfig([parent, child]));
    const roster = makeRoster({
      units: ['UNIT_A', 'UNIT_B'],
      zetas: {
        UNIT_A: ['zeta_UNIT_A_01'],
        UNIT_B: ['zeta_UNIT_B_01'],
      },
    });

    const result = validator.validateArchetype(roster, 'CHILD_ARCH', 'GAC_5v5');

    expect(result.viable).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Inheritance integrity check
  // -------------------------------------------------------------------------

  it('logs a warning and returns shallow archetype when extends target does not exist', () => {
    const orphan = makeArchetype({
      id: 'ORPHAN_ARCH',
      extends: 'NONEXISTENT_PARENT',
      composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
      requiredAbilities: [],
    });

    // Should not throw even with a missing parent
    const validator = new ArchetypeValidator(makeConfig([orphan]));
    const roster = makeRoster({ units: ['UNIT_A'] });

    const result = validator.validateArchetype(roster, 'ORPHAN_ARCH', 'GAC_5v5');

    // Archetype itself is still loaded and runnable
    expect(result.archetypeId).toBe('ORPHAN_ARCH');
    expect(result.viable).toBe(true);
  });

  // -------------------------------------------------------------------------
  // validateCounterByLeader — permissive result for unmapped leader
  // -------------------------------------------------------------------------

  describe('validateCounterByLeader', () => {
    it('returns permissive result for an unmapped leader', () => {
      const validator = new ArchetypeValidator(makeConfig([]));
      const roster = makeRoster({});

      const result = validator.validateCounterByLeader(roster, 'UNKNOWN_LEADER', 'GAC_5v5');

      expect(result.viable).toBe(true);
      expect(result.archetypeId).toBe('NONE');
      expect(result.confidence).toBe(50);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    });

    it('delegates to validateArchetype when leader is mapped', () => {
      const archetype = makeArchetype({
        id: 'MAPPED_ARCH',
        composition: { requiredUnits: ['UNIT_A'], minimumRelics: [] },
        requiredAbilities: [],
      });

      const leaderMapping: LeaderArchetypeMapping = {
        leaderBaseId: 'LEADER_UNIT',
        archetypes: { GAC_5v5: 'MAPPED_ARCH' },
      };

      const validator = new ArchetypeValidator(makeConfig([archetype]), [leaderMapping]);
      const roster = makeRoster({ units: ['UNIT_A'] });

      const result = validator.validateCounterByLeader(roster, 'LEADER_UNIT', 'GAC_5v5');

      expect(result.archetypeId).toBe('MAPPED_ARCH');
      expect(result.viable).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// filterWarningsForSquad
// ---------------------------------------------------------------------------

describe('filterWarningsForSquad', () => {
  it('returns empty array when warnings is undefined', () => {
    expect(filterWarningsForSquad(undefined)).toEqual([]);
  });

  it('always includes plain string warnings', () => {
    const result = filterWarningsForSquad(['Watch out!'], ['UNIT_X']);
    expect(result).toContain('Watch out!');
  });

  it('includes structured warning without relatedUnits regardless of squad', () => {
    const result = filterWarningsForSquad(
      [{ message: 'Global warning' }],
      ['UNIT_A']
    );
    expect(result).toContain('Global warning');
  });

  it('filters out structured warning when relatedUnit is not in squad', () => {
    const result = filterWarningsForSquad(
      [{ message: 'Unit B warning', relatedUnits: ['UNIT_B'] }],
      ['UNIT_A']
    );
    expect(result).toEqual([]);
  });

  it('includes structured warning when relatedUnit is in squad', () => {
    const result = filterWarningsForSquad(
      [{ message: 'Unit B warning', relatedUnits: ['UNIT_B'] }],
      ['UNIT_A', 'UNIT_B']
    );
    expect(result).toContain('Unit B warning');
  });

  it('includes all structured warnings when no squad filter is provided', () => {
    const result = filterWarningsForSquad([
      { message: 'Warning about UNIT_C', relatedUnits: ['UNIT_C'] },
    ]);
    expect(result).toContain('Warning about UNIT_C');
  });
});
