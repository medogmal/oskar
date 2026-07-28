export type RandomizationMethod = 'simple' | 'block';
export type BlindedParty = 'participant' | 'patient' | 'researcher' | 'supervisor' | 'assessor' | 'statistician';
export type BlindingScope = 'material_type' | 'treatment_procedure' | 'split_mouth_side';
export type BlindingType = 'open-label' | 'single-blind' | 'double-blind' | 'triple-blind' | 'quadruple-blind';

export type BlindingSettings = {
  blindedParties: BlindedParty[];
  scope: BlindingScope[];
  targetVariables: string[];
  blindingType: BlindingType;
  protocolText?: string;
  permissions: {
    hideMaterialsFromAssessor: boolean;
    maskGroupsForStatistician: boolean;
  };
};

type BuildBlindingSettingsInput = {
  studyTitle?: string;
  groups?: string[];
  blindedParties?: BlindedParty[];
  scope?: BlindingScope[];
  targetVariables?: string[];
  protocolText?: string;
};

type AllocateGroupInput = {
  groups?: string[];
  method?: RandomizationMethod | null;
  currentCounts?: Record<string, number>;
};

const defaultGroups = ['Experimental', 'Control'];

const blindedPartyOrder: BlindedParty[] = ['participant', 'patient', 'researcher', 'supervisor', 'assessor', 'statistician'];
const validBlindingScopes = new Set<BlindingScope>(['material_type', 'treatment_procedure', 'split_mouth_side']);

export const normalizeStudyGroups = (groups?: string[] | null) => {
  const normalized = Array.from(
    new Set(
      (groups ?? defaultGroups)
        .map((group) => String(group).trim())
        .filter(Boolean),
    ),
  );

  return normalized.length > 0 ? normalized : [...defaultGroups];
};

const normalizeBlindedParties = (parties?: BlindedParty[]) => {
  const normalized = blindedPartyOrder
    .filter((party) => parties?.includes(party))
    .map((party) => (party === 'patient' ? 'participant' : party));
  return Array.from(new Set(normalized)) as BlindedParty[];
};

const normalizeBlindingScope = (scope?: BlindingScope[]) =>
  Array.from(new Set((scope ?? []).filter((item): item is BlindingScope => validBlindingScopes.has(item))));

const normalizeTargetVariables = (values?: string[]) =>
  Array.from(
    new Set(
      (values ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );

const inferBlindingType = (parties: BlindedParty[]): BlindingType => {
  if (parties.length === 0) {
    return 'open-label';
  }

  if (parties.length === 1) {
    return 'single-blind';
  }

  if (parties.length === 2) {
    return 'double-blind';
  }

  if (parties.length === 3) {
    return 'triple-blind';
  }

  return parties.length >= 4 ? 'quadruple-blind' : 'double-blind';
};

const getMaskedGroupCode = (index: number) => `Treatment_${String.fromCharCode(65 + index)}`;

const buildDefaultProtocolText = (input: {
  studyTitle?: string;
  groups: string[];
  blindedParties: BlindedParty[];
  scope: BlindingScope[];
  targetVariables: string[];
  blindingType: BlindingType;
}) => {
  const concealmentText = input.groups
    .map((group, index) => `${group} was coded as ${getMaskedGroupCode(index)}`)
    .join('; ');
  const blindedPartiesText = input.blindedParties.length > 0 ? input.blindedParties.join(', ') : 'no trial parties';
  const scopeText = input.scope.length > 0 ? input.scope.join(', ') : 'allocation identity';
  const targetVariablesText = input.targetVariables.length > 0 ? input.targetVariables.join(', ') : 'group allocation and intervention identity';

  return [
    `Blinding procedures were predefined for "${input.studyTitle?.trim() || 'the study'}" as a ${input.blindingType} design.`,
    `The blinded parties are ${blindedPartiesText}.`,
    `Blinding applies to ${scopeText}.`,
    `The blinded variables are ${targetVariablesText}.`,
    `Allocation concealment uses coded labels: ${concealmentText}.`,
  ].join(' ');
};

export const buildBlindingSettings = (input: BuildBlindingSettingsInput = {}): BlindingSettings => {
  const groups = normalizeStudyGroups(input.groups);
  const blindedParties = normalizeBlindedParties(input.blindedParties);
  const scope = normalizeBlindingScope(input.scope);
  const targetVariables = normalizeTargetVariables(input.targetVariables);
  const blindingType = inferBlindingType(blindedParties);
  const protocolText = input.protocolText?.trim() || buildDefaultProtocolText({
    studyTitle: input.studyTitle,
    groups,
    blindedParties,
    scope,
    targetVariables,
    blindingType,
  });

  return {
    blindedParties,
    scope,
    targetVariables,
    blindingType,
    protocolText,
    permissions: {
      hideMaterialsFromAssessor: blindedParties.includes('assessor'),
      maskGroupsForStatistician: blindedParties.includes('statistician'),
    },
  };
};

export const buildGroupMaskMap = (groups?: string[] | null) =>
  normalizeStudyGroups(groups).reduce<Record<string, string>>((maskMap, group, index) => {
    maskMap[group] = getMaskedGroupCode(index);
    return maskMap;
  }, {});

export const allocateGroup = ({ groups, method = 'simple', currentCounts = {} }: AllocateGroupInput) => {
  const normalizedGroups = normalizeStudyGroups(groups);

  if (method === 'block') {
    const smallestCount = Math.min(...normalizedGroups.map((group) => currentCounts[group] ?? 0));
    const leastRepresentedGroups = normalizedGroups.filter((group) => (currentCounts[group] ?? 0) === smallestCount);
    return leastRepresentedGroups[Math.floor(Math.random() * leastRepresentedGroups.length)] ?? normalizedGroups[0];
  }

  return normalizedGroups[Math.floor(Math.random() * normalizedGroups.length)] ?? normalizedGroups[0];
};
