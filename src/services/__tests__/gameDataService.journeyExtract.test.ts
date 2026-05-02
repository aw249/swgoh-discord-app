import sample from './fixtures/sampleJourneyData.json';
import { parsePrerequisiteFromTask } from '../gameDataService';

describe('parsePrerequisiteFromTask', () => {
  it('parses a relic prereq from descKey + base_id link', () => {
    const r = parsePrerequisiteFromTask({
      id: 'task1',
      descKey: 'GLEVENT_PREREQ_RELIC_05',
      actionLinkDef: { link: 'UNIT_DETAILS?unit_meta=BASE_ID&base_id=BADBATCHHUNTER', type: 1 },
    });
    expect(r).toEqual({ baseId: 'BADBATCHHUNTER', kind: 'relic', value: 5 });
  });

  it('parses a star prereq from descKey + base_id link', () => {
    const r = parsePrerequisiteFromTask({
      id: 'task2',
      descKey: 'GLEVENT_PREREQ_STAR_07',
      actionLinkDef: { link: 'UNIT_DETAILS?unit_meta=BASE_ID&base_id=PADMEAMIDALA', type: 1 },
    });
    expect(r).toEqual({ baseId: 'PADMEAMIDALA', kind: 'star', value: 7 });
  });

  it('returns null for non-prereq descKeys (e.g. meta tasks)', () => {
    expect(parsePrerequisiteFromTask({
      id: 'meta', descKey: 'COMPLETE_PREVIOUS', actionLinkDef: { link: '' },
    })).toBeNull();
  });

  it('returns null when the link has no base_id', () => {
    expect(parsePrerequisiteFromTask({
      id: 'broken', descKey: 'GLEVENT_PREREQ_RELIC_05', actionLinkDef: { link: 'UNIT_DETAILS' },
    })).toBeNull();
  });
});

describe('LORDVADER fixture coverage', () => {
  it('contains 15 tasks across 3 challenges', () => {
    const allTasks = sample.challenge.flatMap(c => c.task ?? []);
    expect(allTasks.length).toBe(15);

    const parsed = allTasks.map(parsePrerequisiteFromTask).filter(Boolean);
    // All 15 should parse — each task has either RELIC_NN or STAR_NN descKey.
    expect(parsed.length).toBe(15);
  });

  it('correctly identifies the four PADMEAMIDALA-style relic-08 prereqs', () => {
    const allTasks = sample.challenge.flatMap(c => c.task ?? []);
    const parsed = allTasks.map(parsePrerequisiteFromTask).filter((p): p is NonNullable<typeof p> => !!p);
    const r8 = parsed.filter(p => p.kind === 'relic' && p.value === 8);
    expect(r8.length).toBeGreaterThan(0);
  });
});
