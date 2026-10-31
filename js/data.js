// HUSH MONEY - data.js (owner: design-writer)
// PE.CFG (spec 14.3 v0.3 RC), PE.SCANDALS (spec 8 / 14.4), PE.LINES (spec 10), PE.TEXT (spec 2-3).
// Pure data. No DOM. All names fictional. ASCII only, every bubble line <= 48 chars.
(function (PE) {
  'use strict';

  // ---------------------------------------------------------------- CFG (14.3)
  PE.CFG = {
    TILE: 32, MAP_W: 96, MAP_H: 64, VIEW_W: 960, VIEW_H: 540, DT: 1 / 60,
    PLAYER_SPEED: 140, SPRINT_MULT: 1.5, NPC_SPEED: 55, PERSON_RADIUS: 7,
    RISE: 11, FALL: 7, MIN_GLOW: 0.10, ACTION_LEAD: 1.0, ACTION_TAIL: 1.5,
    PEAK_FLARE_TIME: 0.5, PEAK_FLASH_TIME: 0.08, BUST_FADE: 0.3,
    PHOTO_RANGE: 170, NEAR_MULT: 1.6, PHOTO_COOLDOWN: 0.6,
    BASE_POINTS: 1000, PERFECT_WINDOW: 0.25, PERFECT_BONUS: 500, MIN_POINTS: 50,
    PENALTY_NO_SCANDAL: 150, PENALTY_TOO_FAR: 100,
    SCANDALS_PER_RUN: 6, FIRST_DELAY: 2, GAP: 3, END_DELAY: 2,
    SPAWN_MIN_TILES: 18, SPAWN_MAX_TILES: 34, SPAWN_OFFSCREEN_MARGIN: 64,
    RELAX_MIN_TILES: 8, RELAX_MAX_TILES: 40,
    BUSTED_FLEE_TIME: 4, BUBBLE_TTL: 2.4, MAX_AMBIENT_BUBBLES: 3, BUMP_COOLDOWN: 10, AMBIENT_COUNT: 60,
    GLOW_COLOR: '#39FF14',
    GRADES: [
      { min: 1500, label: 'PERFECT SHOT' },
      { min: 750, label: 'FRONT PAGE' },
      { min: 400, label: 'JUICY' },
      { min: 150, label: 'TABLOID FILLER' },
      { min: -Infinity, label: 'BLURRY GOSSIP' }
    ],
    RANKS: [
      { min: 7500, label: 'Kingpin of Kompromat' },
      { min: 5000, label: 'Professional Sleazeball' },
      { min: 2500, label: 'Paparazzo with Debts' },
      { min: 0, label: 'Tourist with a Camera' },
      { min: -Infinity, label: 'Owes the Tabloids Money' }
    ]
  };

  // ------------------------------------------------------------ SCANDALS (8)
  // v0.2 timing (RISE 11): 5 setup lines (0.3 2.2 4.1 6.0 7.9), ONE cue line at 9.75 that sets up
  // the action (lean-in starts at 10), silence through the pop at 11, then 3 lines (11.9 14.1 16.3).
  // tip is a template: {area} = spot.name. Role offsets dx/dy, pdx/pdy are px from the spot center.
  PE.SCANDALS = [
    {
      id: 'affair',
      title: 'The Boulevard Affair',
      tip: 'Banker Avner + his "trainer" at {area}.',
      caption: 'BANKER\'S "TRAINER" WORKS ON HIS LIPS',
      kinds: ['boulevard', 'park'],
      roles: [
        { name: 'Avner', look: 'suit', dx: -16, dy: 0, dir: 2, prop: 'none', pdx: -5, pdy: 0 },
        { name: 'Shiraz', look: 'trainer', dx: 16, dy: 0, dir: 6, prop: 'none', pdx: 5, pdy: 0 }
      ],
      peak: { action: 'kiss' },
      lines: [
        { at: 0.3, r: 0, s: 'My wife thinks I\'m at spin class. Ha.' },
        { at: 2.2, r: 1, s: 'Avner, motek. You said six. It\'s 6:40.' },
        { at: 4.1, r: 1, s: 'So? Are you leaving your wife or not?' },
        { at: 6.0, r: 0, s: 'After the merger. After my bonus. Soon.' },
        { at: 7.9, r: 1, s: 'You said that last year, achi. Twice.' },
        { at: 9.75, r: 0, s: 'Shh. Close your eyes, Shiraz... come here.' },
        { at: 11.9, r: 1, s: 'Wait. Was that a camera flash?' },
        { at: 14.1, r: 0, s: 'Act natural. We are discussing squats.' },
        { at: 16.3, r: 1, s: 'Same bench next week. Leave the ring home.' }
      ],
      bust: [
        { r: 0, s: 'No no no! She\'s my PERSONAL trainer!' },
        { r: 1, s: 'I train him. Personally. Bye!' }
      ],
      expire: [{ r: 0, s: 'Back to the bank. Very busy. Banking.' }]
    },
    {
      id: 'drug_deal',
      title: 'Alley Pharmacy',
      tip: 'Kobi is selling "vitamins" at {area}.',
      caption: 'ALLEY "PHARMACIST" HAS NO LICENSE, MANY FANS',
      kinds: ['alley', 'market'],
      roles: [
        { name: 'Kobi', look: 'dealer', dx: -14, dy: 0, dir: 2, prop: 'package', peakProp: 'cash', pdx: -6, pdy: 0 },
        { name: 'Itay', look: 'hipster', dx: 14, dy: 0, dir: 6, prop: 'cash', peakProp: 'package', pdx: 6, pdy: 0 },
        { name: 'Moti', look: 'hoodie', dx: 2, dy: -30, dir: 0, prop: 'phone' }
      ],
      peak: { action: 'deal' },
      lines: [
        { at: 0.3, r: 2, s: 'Clear. Just a cat. And another cat.' },
        { at: 2.2, r: 1, s: 'Achi, you the guy with the "vitamins"?' },
        { at: 4.1, r: 0, s: 'Vitamin K, vitamin X. Whole alphabet.' },
        { at: 6.0, r: 1, s: 'My startup demo is tomorrow. I need focus.' },
        { at: 7.9, r: 0, s: 'Cash only. My crypto is... resting.' },
        { at: 9.75, r: 0, s: 'Okay. Package out, cash in. On three...' },
        { at: 11.9, r: 1, s: 'It says "oregano". Is that the code?' },
        { at: 14.1, r: 0, s: 'Code for "you never saw me", motek.' },
        { at: 16.3, r: 2, s: 'Nu?! Finish already, my mom is calling.' }
      ],
      bust: [
        { r: 0, s: 'It\'s medicinal! For my... business!' },
        { r: 2, s: 'Scatter! I never met these people!' }
      ],
      expire: [{ r: 0, s: 'Same alley Thursday. Exact change.' }]
    },
    {
      id: 'bribe',
      title: 'Permit Express',
      tip: 'Councilman Shaul + builder at {area}.',
      caption: 'COUNCILMAN\'S COFFEE COMES WITH AN ENVELOPE',
      kinds: ['cafe', 'plaza'],
      roles: [
        { name: 'Shaul', look: 'politician', dx: -14, dy: 0, dir: 2, prop: 'coffee', peakProp: 'envelope', pdx: -6, pdy: 0 },
        { name: 'Rafi', look: 'contractor', dx: 14, dy: 0, dir: 6, prop: 'envelope', peakProp: 'none', pdx: 6, pdy: 0 }
      ],
      peak: { action: 'handoff' },
      lines: [
        { at: 0.3, r: 0, s: 'Iced coffee, oat milk. The city pays.' },
        { at: 2.2, r: 1, s: 'Shaul! About my 40-floor tower permit...' },
        { at: 4.1, r: 0, s: 'On a two-floor plot? Bold. I like bold.' },
        { at: 6.0, r: 0, s: 'Committee meets in three years. Unless...' },
        { at: 7.9, r: 1, s: 'Unless I bring a "donation"? I brought it.' },
        { at: 9.75, r: 0, s: 'Okay. Envelope. Slide it over. Now.' },
        { at: 11.9, r: 0, s: 'Permit approved. Plus a parking spot.' },
        { at: 14.1, r: 1, s: 'And the old trees? They block my view.' },
        { at: 16.3, r: 0, s: 'Trees? What trees? Never heard of trees.' }
      ],
      bust: [
        { r: 0, s: 'This envelope is full of... receipts!' },
        { r: 1, s: 'I\'m a simple citizen! Who builds towers!' }
      ],
      expire: [{ r: 0, s: 'Lovely chat. My office never answers.' }]
    },
    {
      id: 'influencer',
      title: '#SaveTheSea',
      tip: 'Eco-influencer Lihi filming at {area}.',
      caption: '#SAVETHESEA STAR DUMPS HER TRASH IN THE SEA',
      kinds: ['beach'],
      roles: [
        { name: 'Lihi', look: 'influencer', dx: -8, dy: 0, dir: 6, prop: 'phone' },
        { name: 'Dor', look: 'assistant', dx: 16, dy: 6, dir: 6, prop: 'trashbag', peakProp: 'none', pdx: -30, pdy: 4 }
      ],
      peak: { action: 'pose' },
      lines: [
        { at: 0.3, r: 0, s: 'Hi loves! Day 40 of my plastic-free life!' },
        { at: 2.2, r: 1, s: 'Lihi, the bag. All your shoot garbage.' },
        { at: 4.1, r: 0, s: 'Hide it! The bin? Too far. Like, 30 meters.' },
        { at: 6.0, r: 1, s: 'So... I walk it to the bin, right?' },
        { at: 7.9, r: 0, s: 'Ring light first. The sea looks too blue.' },
        { at: 9.75, r: 0, s: 'Smile! #SaveTheSea! On my pose, dump it!' },
        { at: 11.9, r: 1, s: 'Done. The waves took it. Very eco.' },
        { at: 14.1, r: 0, s: 'Ugh, a fish photobombed my sunset.' },
        { at: 16.3, r: 0, s: 'Caption: "Leave only footprints." Post!' }
      ],
      bust: [
        { r: 0, s: 'Delete that! I have a sponsor deal!' },
        { r: 1, s: 'I\'m just the intern! Unpaid! Bye!' }
      ],
      expire: [{ r: 0, s: 'Okay loves, link in bio. Kisses!' }]
    },
    {
      id: 'match_fix',
      title: 'Penalty for Sale',
      tip: 'Striker Benny meets a bookie at {area}.',
      caption: 'STAR STRIKER\'S PENALTY MISS: PAID IN ADVANCE',
      kinds: ['kiosk', 'park'],
      roles: [
        { name: 'Benny', look: 'footballer', dx: -14, dy: 0, dir: 2, prop: 'none', peakProp: 'cash', pdx: -7, pdy: 0 },
        { name: 'Zion', look: 'bookie', dx: 14, dy: 0, dir: 6, prop: 'cash', peakProp: 'none', pdx: 7, pdy: 0 }
      ],
      peak: { action: 'shake' },
      lines: [
        { at: 0.3, r: 1, s: 'Benny! Sunday\'s derby. The penalty.' },
        { at: 2.2, r: 0, s: 'What about it? I never miss. Ever.' },
        { at: 4.1, r: 1, s: 'This time you miss. Over the bar.' },
        { at: 6.0, r: 0, s: 'My fans! Kids wear my shirt, achi!' },
        { at: 7.9, r: 1, s: 'Your kids want a pool. Fifty thousand.' },
        { at: 9.75, r: 1, s: 'Deal? Wide left. Shake on it, champion.' },
        { at: 11.9, r: 0, s: 'Nobody saw. The kiosk guy is asleep.' },
        { at: 14.1, r: 1, s: 'Miss with passion. Cry a bit. Kneel.' },
        { at: 16.3, r: 0, s: 'I\'ll blame the grass. Always the grass.' }
      ],
      bust: [
        { r: 0, s: 'It\'s an autograph! For his mother!' },
        { r: 1, s: 'I sell lottery tickets! Legal ones!' }
      ],
      expire: [{ r: 1, s: 'See you Sunday. Aim for the pigeons.' }]
    },
    {
      id: 'inspector',
      title: 'Five-Star Rat',
      tip: 'Inspector Dvora + falafel guy at {area}.',
      caption: 'INSPECTOR GIVES RAT-RUN STAND FIVE STARS',
      kinds: ['market', 'kiosk'],
      roles: [
        { name: 'Dvora', look: 'inspector', dx: -14, dy: 0, dir: 2, prop: 'clipboard', peakProp: 'cash', pdx: -6, pdy: 0 },
        { name: 'Shimi', look: 'chef', dx: 14, dy: 0, dir: 6, prop: 'cash', peakProp: 'none', pdx: 6, pdy: 0 }
      ],
      peak: { action: 'handoff' },
      lines: [
        { at: 0.3, r: 0, s: 'Health inspection. Is that a rat?' },
        { at: 2.2, r: 1, s: 'That? That\'s Moshe. He\'s a regular.' },
        { at: 4.1, r: 0, s: 'Moshe is eating your pita, motek.' },
        { at: 6.0, r: 0, s: 'Fridge is 19 degrees. Fryer oil is black.' },
        { at: 7.9, r: 1, s: 'That\'s... flavor. Can we talk, nu?' },
        { at: 9.75, r: 1, s: 'A small "tasting fee". Take it. Quick.' },
        { at: 11.9, r: 0, s: 'Five stars! Spotless! Extra tahini?' },
        { at: 14.1, r: 1, s: 'Moshe, wave to the inspector. Good boy.' },
        { at: 16.3, r: 0, s: 'I\'ll inspect again next month. Hungry.' }
      ],
      bust: [
        { r: 0, s: 'This is evidence! I\'m... collecting it!' },
        { r: 1, s: 'Moshe! Run! Take the cash box!' }
      ],
      expire: [{ r: 0, s: 'Clean as a whistle. Stamp. Bye.' }]
    },
    {
      id: 'protest',
      title: 'Rent-a-Crowd',
      tip: 'Gadi\'s "grassroots" rally at {area}.',
      caption: 'GRASSROOTS RALLY? FIFTY SHEKELS AN HOUR, CASH',
      kinds: ['plaza', 'boulevard'],
      roles: [
        { name: 'Gadi', look: 'politician', dx: 0, dy: -20, dir: 4, prop: 'cash', pdx: 0, pdy: -12 },
        { name: 'Protester', look: 'protester', dx: -22, dy: 12, dir: 0, prop: 'sign' },
        { name: 'Protester', look: 'protester', dx: 0, dy: 18, dir: 0, prop: 'sign' },
        { name: 'Protester', look: 'protester', dx: 22, dy: 12, dir: 0, prop: 'sign' }
      ],
      peak: { action: 'shout' },
      lines: [
        { at: 0.3, r: 0, s: 'Okay people. Signs up. Angry faces.' },
        { at: 2.2, r: 1, s: 'What are we against today, achi?' },
        { at: 4.1, r: 0, s: 'Rent prices! Which I will lower. Somehow.' },
        { at: 6.0, r: 2, s: 'Gadi, you own twelve apartments.' },
        { at: 7.9, r: 0, s: 'Thirteen. Shh. Fifty an hour, cash.' },
        { at: 9.75, r: 0, s: 'Cameras! Deep breath. On three: SCREAM.' },
        { at: 11.9, r: 1, s: 'Down with... what does my sign say?' },
        { at: 14.1, r: 2, s: 'Lower the rent! Raise my pay! Wait...' },
        { at: 16.3, r: 3, s: 'It\'s six. Shift over. Yalla, pay up.' }
      ],
      bust: [
        { r: 0, s: 'Spontaneous! A totally spontaneous crowd!' },
        { r: 2, s: 'I\'m a tourist! I don\'t know this man!' }
      ],
      expire: [{ r: 0, s: 'Same time tomorrow. Bring other hats.' }]
    }
  ];

  // ------------------------------------------------------------- LINES (10)
  PE.LINES = {
    walker: [
      'Rent went up again. My balcony is a "room" now.',
      'Sababa, sababa, everything is sababa.',
      'Is this bus ever coming? It\'s been a week.',
      'Who parks a scooter in the middle of a sidewalk?',
      'Forty shekels for a salad. Forty!',
      'One iced coffee and I become a person.',
      'Yalla, I\'m late. I\'m always late. It\'s fine.',
      'Sea breeze! Also humidity. Mostly humidity.',
      'Landlord wants six months up front. Funny guy.',
      'Which way is the sea? ...Oh. West. Obviously.',
      'Achi, don\'t step on the cat.',
      'I moved here for the vibes. Vibes cost 7k.'
    ],
    phone: [
      'Ima, I\'m eating! Yes! Vegetables! Bye!',
      'No, the pitch deck is fine. Add more "AI".',
      'Motek, I\'m on the bus. It\'s late. Of course.',
      'Hold on, I\'m losing you, I\'m under a ficus.',
      'Two rooms, no window, 6,500? Sababa, deal.',
      'Nu? Did they reply? No? Great. Great.',
      'Tell the investors we pivot. To what? Yes.',
      'Habibi, put me on speaker. Hi everyone!',
      'I\'m not yelling, this is my phone voice!',
      'Yes I saw your story. Yes I loved it. Bye.'
    ],
    cafe: [
      'We\'re an app for falafel. With blockchain.',
      'I quit my job to do a podcast about quitting.',
      'The croissant was 28 shekels. I\'m in debt.',
      'I live with four roommates and a parrot.',
      'Another iced coffee. Extra ice. Extra drama.',
      'My startup died but my profile is thriving.',
      'Laptop tables only? I have a pita, achi.',
      'We raised a seed round. From my uncle.',
      'Waiter? Waiter! ...He\'s on a smoke break.',
      'Everyone here is a founder. Who pours coffee?'
    ],
    vendor_falafel: [
      'Falafel! Hot! Crispy! Better than your ima\'s!',
      'Hummus, tahini, chips inside? Sababa!',
      'Extra amba? You\'ll smell it till Sunday.',
      'Pita or laffa, motek? Decide, there\'s a line!',
      'Five balls! Okay, four. Okay, five! Yalla!',
      'Salads are free! Within reason, habibi!',
      'Best falafel on the street! Ask my cousin!',
      'Hot chips! Fried today! Probably today!',
      'Who\'s hungry? Everybody\'s hungry! Yalla!',
      'Spicy? Very spicy? Tourist spicy? I have all.'
    ],
    vendor_kiosk: [
      'Iced coffee! Pitzutziot! Gum! Batteries!',
      'Ice cream! Cold drinks! Free life advice!',
      'Sunflower seeds! Spit shells there, not here!',
      'Open 24 hours! Except when I nap!',
      'Charger? Umbrella? Toothbrush? I got it!',
      'Cold water! Colder than your ex!',
      'Achi, buy something or stop hugging my fridge.',
      'Newspaper! Scandals! Fresh scandals daily!',
      'Two flavors, one price, yalla kids!',
      'Chocolate milk in a bag! National treasure!'
    ],
    vendor_market: [
      'Tomatoes! Ten shekels! For you, eight!',
      'Watermelon! Sweet like honey! Taste, taste!',
      'Strawberries! Two boxes, twenty! Yalla yalla!',
      'Spices! Paprika! Cumin! Mystery powder!',
      'Avocado! Ripe today! Rock hard tomorrow!',
      'Cheap cheap cheap! Everything! Except rent!',
      'Achi, don\'t squeeze! You squeeze, you buy!',
      'Dates! Figs! Pomegranates! Cash only!',
      'Fresh fish! From the sea! It\'s right there!',
      'Last box! Last price! Final final price!'
    ],
    beach: [
      'Is it four yet? The sun is attacking me.',
      'Who put sand in my iced coffee? The wind?',
      'Lifeguard says no swimming. I\'m floating.',
      'SPF 50, a hat, and still I\'m a tomato.',
      'Jellyfish are back. They don\'t pay rent either.',
      'Beach chair, 20 shekels. Sitting is business.',
      'Ahh. No email at the beach. No signal at all.',
      'Watch out for the matkot. It\'s a war zone.',
      'Pass the watermelon, motek. And the knife.',
      'Waves are perfect today. I\'m not getting up.'
    ],
    jogger: [
      'Hhh... ten more... kilometers... hhh...',
      'On your left! Your other left!',
      'Personal best! Or worst! Who\'s counting!',
      'Promenade loop number six. Feel the burn.',
      'My watch says I\'m dying. Sababa.',
      'Runner coming through! Fast! Ish!',
      'Training for the marathon. It\'s in 2031.',
      'Is that falafel I smell? No. Focus. Run.',
      'Run club at six! Coffee club at 6:05!',
      'Out of my way, I\'m burning off a croissant!'
    ],
    matkot: [
      'Tok! Tok! Tok! Tok!',
      'Achi, gentle! It\'s not a war!',
      'That one is on you! Go get it!',
      'Tok... tok... TOK! Sorry! Sorry, auntie!',
      'Forty years of matkot. Still no rules.',
      'Higher! The wind takes it! Higher!',
      'Yalla, two hundred hits and we eat.',
      'Don\'t drop it! Don\'t drop... you dropped it.',
      'My shoulder! Keep going! My shoulder!',
      'Tok tok tok. The sound of summer, habibi.'
    ],
    dogwalker: [
      'Shoko, no! Not the falafel! Leave it!',
      'He\'s friendly! He just hates scooters.',
      'Who\'s a good boy? Not the scooter guy.',
      'Pitzi! Pitzi, come! ...Wrong dog. Sorry.',
      'I\'m getting a bag! Relax, achi!',
      'Two walks a day and he still runs my flat.',
      'My dog has more followers than my startup.',
      'Slow down, Bruno! I\'m not a jogger!',
      'He\'s a rescue. He rescued me from dating.',
      'Sit! Sit! ...Okay, we stand. Sababa.'
    ],
    scooter: [
      'Ding ding!',
      'Ding ding! Sidewalk is my lane, achi!',
      'Out of the way! I\'m late! Ding ding!',
      'Helmet? My hair is my helmet.',
      'Ding! Ding! Pedestrians on MY sidewalk!',
      'Twenty-five km/h of pure freedom!',
      'Sorry auntie! Ding ding! Sorry!',
      'Bike lane? Too slow. Sidewalk, yalla!',
      'Battery three percent! Ding ding! Pray!',
      'Coming through! Delivery! Cold falafel!'
    ],
    bump: [
      'Hey! Watch it, achi!',
      'Nu? There\'s a whole sidewalk!',
      'Excuse YOU, habibi.',
      'Ow! My iced coffee!',
      'Are you following me? Weirdo.',
      'Personal space, motek. Look it up.',
      'Nice coat. Very 1950s.',
      'A trench coat? In this heat? Respect.',
      'Careful! I just ironed this! Not really.',
      'You smell like old film and regret.'
    ],
    photographed: [
      'Did you just photograph me?!',
      'Hey! Delete that! I\'m not camera ready!',
      'Who are you, the tax authority?',
      'Creep! Photos cost money, achi!',
      'Get my good side next time. The left.',
      'I\'ll sue! I\'ll sue you in the comments!',
      'Is this a tourist thing? Smile? Okay.',
      'No photos! My ex can\'t know I\'m here!',
      'Great. Now I\'m in some guy\'s collection.',
      'Cameras again? This city, honestly.'
    ],
    player_good: [
      'Click. That\'s rent for the month.',
      'Front page, baby. Somebody call my editor.',
      'Smile. You\'re on hush camera.',
      'That\'s the shot. Now we negotiate.',
      'Sweet, sweet kompromat.',
      'Ka-ching. Silence is expensive.',
      'Got it. I love this job. I hate this job.',
      'Perfect. My landlord thanks you.',
      'Pure gold. Pure, sleazy gold.',
      'One click, two careers ruined. Sababa.'
    ],
    player_bad: [
      'Great. A photo of a ficus. Award winner.',
      'That\'s film I can\'t afford.',
      'Too far. My lens isn\'t a telescope.',
      'Nice shot of nothing. Very artistic.',
      'Easy, trigger finger. Wait for it.',
      'Pigeons. I photographed pigeons. Again.',
      'My editor is going to frame that. As a joke.',
      'Wasted film. Wasted life. Moving on.',
      'Get closer, genius. You are not a drone.',
      'Nobody pays hush money for blurry tourists.'
    ],
    player_miss: [
      'Missed it. There goes the rent.',
      'Gone. The scandal walked off without me.',
      'Too slow, achi. Way too slow.',
      'Someone else will sell that one. Not me.',
      'And the glow fades. Like my career.',
      'Next time I skip the falafel line.',
      'Missed. The tabloids will never know. Sad.',
      'That was a whole headline. Gone.',
      'Nu? Legs! Use your legs next time!',
      'Scandal over. Hush money: zero.'
    ],
    player_idle: [
      'Pager\'s quiet. Like my bank account.',
      'Come on, somebody do something shameful.',
      'This city is full of secrets. Sell me one.',
      'I could get a real job. Ha. Imagine.',
      'An iced coffee would fix me. Or rent money.',
      'Waiting for sin. Sin is late. Like the bus.',
      'Every bench here has a story. Most are dull.',
      'Nice weather for blackmail.',
      'Somewhere a councilman is thirsty. For cash.',
      'The fedora was a mistake. It\'s 34 degrees.'
    ]
  };

  // -------------------------------------------------------------- TEXT (2-3)
  PE.TEXT = {
    title: 'HUSH MONEY',
    subtitle: 'Photograph the scandal. Sell the silence.',
    controls: [
      'W A S D / Arrows - walk',
      'Shift (hold) - jog',
      'Space / K - take photo',
      'P / Esc - pause',
      'R - restart run',
      'M - mute',
      '` (backquote) - debug overlay'
    ],
    start: 'Press Enter',
    hint1: 'Get IN RANGE. Read the cue, watch the lean-in, then snap!',
    pause: 'PAUSED - P / Esc to resume, R to restart',
    resultsHint: 'R / Enter: blackmail again'
  };

  // Phones / tablets (coarse pointer): main.js copies these over PE.TEXT at boot.
  PE.TEXT_TOUCH = {
    controls: [
      'Left half - drag to walk',
      'Drag to the rim - jog',
      'Right half / SNAP - take photo',
      'II (top right) - pause, restart, sound',
      'No sound? Check your phone is not on silent.'
    ],
    start: 'Tap to start',
    pause: 'Tap anywhere else to resume',
    resultsHint: 'Tap to blackmail again'
  };
})(globalThis.PE = globalThis.PE || {});
