// Demo data for the offline demo build ONLY (npm run build:demo, the standalone HTML, npm run dev).
// The production build (npm run build) never includes this file: see DEMO_BUILD in App.jsx.
// Demo PINs: 0000 Admin · 1111 RM Team 1 · 2222 Segment 10 · 3333 Epoxy 1 · 4444 Epoxy 2.
export const DEMO_ADMIN_PIN = '0000';
export const DEMO_TEAMS = [
  { id: 'team1', short: 'RM Team 1', name: 'Bridge RM_Team 1', leadman: 'Pijay Tanjeco', pin: '1111', unit: 'Locations',
    crew: [['Justin Billones','Skilled'],['Ignacio Alcoriza Jr.','Crew'],['Alvin Angelo','Crew'],['Joven Blanza','Crew'],['Rocky Miranda','Crew'],['Richard Candelaria','Crew'],['Crisostomo Sebuc','Crew']],
    absent: { 'Rocky Miranda': 'Sick' },
    seed: { att: '6:58 AM', act: '3:42 PM', before: true, after: true },
    form: { from: '07:00', to: '16:00', location: 'SAPANG BAGO RIVER BRIDGE', details: 'Parapet cleaning, Deck slab cleaning, Girder and pier cleaning, Slope protection cleaning, Grass cutting, Trimming trees', status: 'COMPLETE', targetLoc: '1', actualLoc: '1', plate: 'NFJ 6654', targetMH: '8', actualMH: '7', remarks: 'Area turned over clean. Tree trimmings hauled to stockpile.' },
    history: [
      { date: '2026-09-26', location: 'MABALACAT RIVER BRIDGE', details: 'Parapet cleaning, Grass cutting, Trimming trees', status: 'COMPLETE', att: '7/8', photos: 2 },
      { date: '2026-09-25', location: 'STO. TOMAS RIVER BRIDGE', details: 'Deck slab cleaning, Slope protection cleaning', status: 'COMPLETE', att: '8/8', photos: 2 },
      { date: '2026-09-23', location: 'PAMPANGA RIVER BRIDGE North bound', details: 'Girder and pier cleaning, Grass cutting', status: 'COMPLETE', att: '7/8', photos: 2 } ] },
  { id: 'team2', short: 'Segment 10', name: 'Segment 10 Scupper Drain', leadman: 'Glenn Butiong', pin: '2222', unit: 'KM',
    crew: [['Glen Jorick De Mesa','Skilled'],['Justine Gregg Baylon','Skilled'],['John Christian Bernardo','Crew'],['Ian Enriquez','Crew'],['Joanner Royce Quilao','Crew'],['Rolando Faustino','Crew'],['Richard Santiago','Crew'],['Abraham Balmeo','Crew']],
    absent: { 'Abraham Balmeo': 'Leave', 'Rolando Faustino': 'No show' },
    seed: { att: '7:05 AM', act: null, before: true, after: false },
    form: { from: '07:00', to: '16:00', location: 'Km.11+000 to km.10+020 C3 exit ramp', details: 'Cleaning of clogged scupper drain', status: 'COMPLETE', targetLoc: '1', actualLoc: '1', plate: 'NKU 8624', targetMH: '8', actualMH: '7', remarks: 'After photo pending — crew still flushing the last scupper.' },
    history: [
      { date: '2026-09-26', location: 'Km.10+020 to Km.9+400 C3 exit ramp', details: 'Cleaning of clogged scupper drain', status: 'COMPLETE', att: '8/9', photos: 2 },
      { date: '2026-09-25', location: 'Km.12+500 NB main line', details: 'Cleaning of clogged scupper drain, debris removal', status: 'COMPLETE', att: '9/9', photos: 2 },
      { date: '2026-09-23', location: 'Km.9+400 to Km.8+800 C4 entry ramp', details: 'Cleaning of clogged scupper drain', status: 'ONGOING', att: '7/9', photos: 1 } ] },
  { id: 'team3', short: 'Epoxy 1', name: 'Bridge Epoxy 1', leadman: 'Allan Miranda', pin: '3333', unit: 'Locations',
    crew: [['Elmer Dordulo','Skilled'],['Edwin Lozano','Skilled'],['R-Jay John Aquino','Crew'],['Mark Joseph De Guzman','Crew'],['Edbryan Dela Cruz','Crew'],['Mark Ian Dungca','Crew'],['Johnry Manese','Crew'],['Eroll Pangilinan','Crew']],
    absent: { 'Eroll Pangilinan': 'Sick' },
    seed: { att: null, act: null, before: true, after: false },
    form: { from: '07:00', to: '17:00', location: 'CANDABA VIADUCT North bound', details: 'Inject epoxy girder 3-4-5, Pier 111-112', status: 'ONGOING', targetLoc: '3', actualLoc: '2', plate: 'NCG 5500', targetMH: '8', actualMH: '8', remarks: '' },
    history: [
      { date: '2026-09-26', location: 'CANDABA VIADUCT North bound', details: 'Inject epoxy girder 1-2, Pier 109-110', status: 'ONGOING', att: '9/9', photos: 2 },
      { date: '2026-09-25', location: 'CANDABA VIADUCT South bound', details: 'Inject epoxy girder 6-7, Pier 113-114', status: 'COMPLETE', att: '8/9', photos: 2 },
      { date: '2026-09-23', location: 'CANDABA VIADUCT South bound', details: 'Surface preparation, crack sealing', status: 'COMPLETE', att: '8/9', photos: 2 } ] },
  { id: 'team4', short: 'Epoxy 2', name: 'Bridge Epoxy 2', leadman: 'Gilbert Rivera', pin: '4444', unit: 'Locations',
    crew: [['Alvin Galang','Skilled'],['Ivan Cabunag','Crew'],['AJ Enriquez','Crew'],['Jaypee Occidental','Crew'],['Edgar Ortillo','Crew'],['Voltaire Rotamula','Crew'],['Joshua Andrei Tayco','Crew']],
    absent: { 'Voltaire Rotamula': 'Leave' },
    seed: { att: '7:10 AM', act: null, before: true, after: true },
    form: { from: '07:00', to: '17:00', location: 'CANDABA VIADUCT North bound', details: 'Dismantle remaining half of scaffolding, moving to pier 110-111', status: 'ONGOING', targetLoc: '2', actualLoc: '1', plate: 'NEO 5124', targetMH: '8', actualMH: '7', remarks: 'Scaffolding to be re-erected at pier 110-111 tomorrow.' },
    history: [
      { date: '2026-09-26', location: 'CANDABA VIADUCT North bound', details: 'Dismantle scaffolding pier 108-109', status: 'ONGOING', att: '7/8', photos: 2 },
      { date: '2026-09-25', location: 'CANDABA VIADUCT North bound', details: 'Erect scaffolding pier 110-111', status: 'COMPLETE', att: '8/8', photos: 2 },
      { date: '2026-09-23', location: 'CANDABA VIADUCT South bound', details: 'Dismantle remaining scaffolding pier 105-106', status: 'COMPLETE', att: '6/8', photos: 2 } ] },
];
