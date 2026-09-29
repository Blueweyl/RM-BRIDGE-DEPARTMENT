// Quick activity templates: common work descriptions per team, to fill "Activity details" fast.
// Picking one only fills the text box — the leadman can still edit it before submitting, and the
// server validates the report exactly as before. Teams not listed here get the general list.
export const ACTIVITY_TEMPLATES = {
  // Bridge RM_Team 1 — routine bridge maintenance and cleaning
  team1: [
    'Bridge deck cleaning and removal of accumulated debris',
    'Parapet wall cleaning and removal of dirt and vegetation',
    'Girder and pier cleaning',
    'Slope protection cleaning and clearing',
    'Grass cutting at bridge approaches and surrounding areas',
    'Trimming of trees and overgrown vegetation near bridge structures',
    'Bridge sidewalk and walkway cleaning',
    'Removal of accumulated soil, silt and waste materials',
    'Bridge railing cleaning and visual inspection',
    'General bridge maintenance, housekeeping and hauling of collected waste',
  ],
  // Segment 10 Scupper Drain — drainage
  team2: [
    'Cleaning of clogged scupper drains',
    'Removal of accumulated silt from scupper drains',
    'Removal of leaves, plastics and solid debris from drainage inlets',
    'Manual unclogging of blocked scupper drains',
    'Cleaning of drainage outlets and discharge points',
    'Flushing of scupper drains and drainage lines',
    'Removal of accumulated sediment along drainage channels',
    'Inspection and cleaning of scupper drain openings',
    'Clearing of vegetation around drainage structures',
    'Collection, loading and proper disposal of waste removed from scupper drains',
  ],
  // Bridge Epoxy 1 — epoxy injection and crack repair
  team3: [
    'Concrete crack inspection, marking and measurement',
    'Surface preparation and cleaning of concrete cracks',
    'Installation of injection ports along identified cracks',
    'Sealing of crack surface using epoxy paste',
    'Epoxy injection of cracks on bridge girder',
    'Epoxy injection of cracks on pier and pier cap',
    'Monitoring of epoxy penetration and checking for leakage',
    'Re-injection of incomplete or unfilled crack sections',
    'Removal of injection ports and grinding of repaired surface',
    'Final inspection, finishing and documentation of completed epoxy repair',
  ],
  // Bridge Epoxy 2 — scaffolding and epoxy injection
  team4: [
    'Erection of scaffolding for bridge repair access',
    'Dismantling of scaffolding after completion of repair works',
    'Transfer and re-erection of scaffolding to the next pier or girder',
    'Concrete crack inspection and marking before epoxy repair',
    'Surface preparation and cleaning of identified cracks',
    'Installation of epoxy injection ports and surface sealing',
    'Epoxy injection of cracks on girder and pier sections',
    'Monitoring and re-injection of incomplete epoxy-filled cracks',
    'Removal of injection ports and surface finishing',
    'Final inspection, housekeeping and transfer of materials to the next work location',
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
