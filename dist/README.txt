===============================================================
  FAUNA HUNT  -  a wildlife spotting game for Flight Simulator
===============================================================

  Microsoft Flight Simulator 2024 has 107 species of animal
  wandering around the world. Fauna Hunt turns finding them
  into the point of the flight.

  It does NOT show you where the animals are. It behaves like
  a spotter calling contacts over the intercom - vague at long
  range, sharper as you close in - and it never tells you what
  the animal is. Working that out by looking at it is the game.


---------------------------------------------------------------
  WHAT YOU NEED
---------------------------------------------------------------

  * Microsoft Flight Simulator 2024

  That is all. Nothing to install, no accounts, no internet.


---------------------------------------------------------------
  STEP 1 - INSTALL THE ADD-ON
---------------------------------------------------------------

  Inside this zip there is a folder called:

      wilem35-fauna-hunt

  Copy that whole folder into your MSFS Community folder.

  Don't know where your Community folder is? Do this:

    1. Press the Windows key and type:   %APPDATA%
       Press Enter. A folder window opens.

    2. Look for a folder named
       "Microsoft Flight Simulator 2024".
       If it is there, open it, then open "Packages", then
       "Community". That is the place.

    3. If it is NOT there, you have the Microsoft Store or
       Xbox version. Press the Windows key, type this and
       press Enter:

       %LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\Packages

       Open the "Community" folder inside.

  When you are done it should look like this:

      Community\wilem35-fauna-hunt\manifest.json
      Community\wilem35-fauna-hunt\html_ui\...
      Community\wilem35-fauna-hunt\Service\...

  If you ended up with Community\wilem35-fauna-hunt\wilem35-fauna-hunt\
  you have gone one folder too deep - move it up a level.


---------------------------------------------------------------
  STEP 2 - START THE HELPER
---------------------------------------------------------------

  Fauna Hunt has a small helper program that reads animal
  positions out of the simulator. It has to be running for
  the game to work.

  Go into the folder you just copied, open the "Service"
  folder, and double-click:

      FaunaHuntService.exe

  A black window opens and says it is waiting for the
  simulator. LEAVE THIS WINDOW OPEN while you fly.
  Minimise it if it is in the way.

  ** WINDOWS WILL WARN YOU THE FIRST TIME **

  Because this is a small hobby program and not signed with
  an expensive certificate, Windows shows a blue box saying
  "Windows protected your PC".

      Click "More info", then click "Run anyway".

  Your antivirus may also flag it for the same reason. This
  is normal for programs built this way. If you would rather
  not, tell me and I will send you the plain source code to
  run instead - it does exactly the same thing.

  You can start this before or after the simulator - it
  waits, and it reconnects on its own if you restart the sim.

  It only talks to your own PC. Nothing is sent anywhere,
  and no internet connection is needed.


---------------------------------------------------------------
  STEP 3 - PLAY
---------------------------------------------------------------

  1. Start Flight Simulator 2024 and load a flight.

  2. In the toolbar at the top of the screen, click the paw
     print icon.

     NOTE: the icon is currently very dark and is hard to see
     at night. This is a known bug. It sits with the other
     toolbar icons - hover along them and you will find it.

  3. Fly low and slow over open country. Animals only appear
     within a few kilometres of you near the ground, and much
     further out when you are high up - so climb to search a
     wide area, then descend to get a proper look.

  4. The panel lists what is around you, for example:

         a large animal, 7 of them
         bearing 250 deg                    1100 m

     Get closer and it sharpens up:

         7 animals
         your 2 o'clock, low                 400 m    IDENTIFY

  5. When you can actually SEE the animals out of the window,
     tap that line in the panel.

  6. You get four possible species. Pick the one you think it
     is. Getting it right first time is worth the most.

     - "Back out" closes it again and costs 5 points. Your
       four choices are remembered, so you cannot cheat by
       backing out and trying for easier options.
     - "I can't tell - show me" tells you the answer, but
       you score nothing.

  7. The Lifelist tab tracks every species you have found,
     out of all 107. Most of them are African, so a bush trip
     over the Serengeti is worth far more than a lap of the
     local farmland.


---------------------------------------------------------------
  SETTINGS
---------------------------------------------------------------

  Text size    Five sizes. Start on Medium. VR users will
               probably want Large or Extra Large.

  Difficulty   Explorer  - details arrive early, easier
               Tracker   - the intended balance
               Expert    - you stay in the dark much longer,
                           but everything scores 50% more

  Reset        Wipes your score and lifelist. Cannot be undone.


---------------------------------------------------------------
  GOOD PLACES TO HUNT
---------------------------------------------------------------

  HTSN   Seronera, Serengeti, Tanzania    - the best of them
  HKAM   Amboseli, Kenya
  FASZ   Skukuza, Kruger, South Africa

  Anywhere with farmland will give you cattle, sheep and
  horses to practise on.


---------------------------------------------------------------
  IF SOMETHING IS WRONG
---------------------------------------------------------------

  Panel says "Data service not running"
     The black helper window is not open. Go back to Step 2.
     If Windows blocked it, click "More info" then "Run anyway".

  Panel says "Waiting for the simulator"
     Normal before a flight has loaded. It will connect by
     itself once you are in the aircraft.

  No paw print icon in the toolbar
     The folder is in the wrong place. Check Step 1 again -
     you should see manifest.json directly inside
     Community\wilem35-fauna-hunt\

  No animals anywhere
     You are probably too high, or over a city or ocean.
     Drop to a few thousand feet over open countryside.

  Nothing but cattle, sheep and horses
     That is genuinely all there is in most of Europe and
     North America. The interesting animals are in Africa.


---------------------------------------------------------------

  This is a test build. Tell me what breaks, what is confusing,
  and whether the difficulty feels right.
