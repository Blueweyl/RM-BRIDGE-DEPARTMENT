// Quick activity templates: common work descriptions per team, to fill "Activity details" fast.
// Picking one only fills the text box — the leadman can still edit it before submitting, and the
// server validates the report exactly as before. Teams not listed here get the general list.
export const ACTIVITY_TEMPLATES = {
  // Bridge RM_Team 1 — routine bridge maintenance and cleaning
  team1: [
    'Parapet cleaning, Deck slab cleaning, Girder and pier cleaning, Slope protection cleaning, Grass cutting, Trimming trees',
    'Parapet cleaning, Grass cutting, Trimming trees',
    'Deck slab cleaning, Slope protection cleaning',
    'Girder and pier cleaning, Grass cutting',
    'Cleaning of expansion joints and removal of debris',
    'Cleaning of bridge scuppers and deck drains',
    'Grass cutting and clearing of vegetation at bridge approaches and slope protection',
    'Trimming of trees and hauling of cut branches to stockpile',
    'Removal of garbage and debris under the bridge and along the riverbanks',
    'Repainting of bridge railings and parapet markings',
  ],
  // Segment 10 Scupper Drain — drainage
  team2: [
    'Cleaning of clogged scupper drain',
    'Cleaning of clogged scupper drain, debris removal',
    'Desilting of scupper drains and downspouts',
    'Flushing of scupper drains and downspouts with water',
    'Removal of silt and debris from drainage outlets',
    'Declogging of downspout pipes',
    'Cleaning of catch basins and drainage inlets',
    'Clearing of vegetation and garbage at drainage outfalls',
    'Inspection and cleaning of scupper grates',
    'Hauling of collected silt and debris to stockpile',
  ],
  // Bridge Epoxy 1 — epoxy injection and crack repair
  team3: [
    'Inject epoxy on girder cracks',
    'Inject epoxy on pier and pier cap cracks',
    'Surface preparation, crack sealing',
    'Installation of injection ports and surface sealing of cracks',
    'Crack mapping and marking of girder and pier cracks',
    'Grinding and cleaning of concrete surface before epoxy injection',
    'Removal of injection ports and finishing of injected surface',
    'Erect scaffolding for epoxy works',
    'Dismantle scaffolding and transfer to the next pier',
    'Curing and inspection of epoxy-injected cracks',
  ],
  // Bridge Epoxy 2 — epoxy injection and scaffolding
  team4: [
    'Erect scaffolding at pier',
    'Dismantle scaffolding, moving to the next pier',
    'Dismantle remaining half of scaffolding, moving to the next pier',
    'Inject epoxy on girder cracks',
    'Inject epoxy on pier and pier cap cracks',
    'Surface preparation, crack sealing',
    'Installation of injection ports and surface sealing of cracks',
    'Grinding and cleaning of concrete surface before epoxy injection',
    'Removal of injection ports and finishing of injected surface',
    'Hauling and stockpiling of scaffolding materials',
  ],
};

const GENERAL = [
  'Routine bridge cleaning',
  'Grass cutting and clearing of vegetation',
  'Cleaning of clogged scupper drain',
  'Removal of debris and garbage',
  'Surface preparation, crack sealing',
  'Inject epoxy on girder cracks',
  'Erect scaffolding',
  'Dismantle scaffolding',
  'Repainting of railings and markings',
  'Hauling of materials and debris to stockpile',
];

/** The templates for a team (the general list for a team not listed above). */
export function templatesFor(teamId) {
  return ACTIVITY_TEMPLATES[teamId] || GENERAL;
}
