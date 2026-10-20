//! Demo data is created through the same domain operations as real clients.
use crate::*;
use rusqlite::params;

impl Store {
    pub fn seed_demo(&self) -> Result<Jam> {
        let before = self.latest_seq()?;
        let end = (time::OffsetDateTime::now_utc() + time::Duration::hours(31))
            .format(&time::format_description::well_known::Rfc3339)
            .expect("UTC");
        let (j, danil) = self.create_jam(
            "Cozy Jam 48",
            Some("Small lights"),
            Some(&now()),
            Some(&end),
            "UTC",
            "Danil",
        )?;
        let mira = self.add_human(&danil.id, "Mira", MEMBER_COLORS[1], Some("🎧"))?;
        let alex = self.add_human(&danil.id, "Alex", MEMBER_COLORS[2], Some("🎨"))?;
        let codex = self.identify_agent("Codex", "codex")?;
        let claude = self.identify_agent("Claude", "claude-code")?;
        let titles = [
            ("Cozy cabin ending sketch", "art"),
            ("Optional firefly companion", "gameplay"),
            ("Snow trail variations", "art"),
            ("Accessibility: color cues", "ui"),
            ("Weather ambience layers", "audio"),
            ("Controller rumble ideas", "tech"),
            ("Player movement: coyote time & jump buffer", "gameplay"),
            ("Lantern glow shader", "art"),
            ("Title screen layout", "ui"),
            ("SFX: footsteps on snow", "audio"),
            ("Save/load settings", "tech"),
            ("Pause menu", "ui"),
            ("Particles for light pickup", "polish"),
            ("Playtest round 1 notes", "bug"),
            ("Tune lantern battery curve", "gameplay"),
            ("Light puzzle: frozen bridge", "gameplay"),
            ("Cabin interior sprites", "art"),
            ("Wind loop and transitions", "audio"),
            ("Keyboard remapping", "tech"),
            ("Collectible star feedback", "polish"),
            ("Camera follow smoothing", "gameplay"),
            ("Review snow collision edges", "bug"),
            ("Credits screen", "ui"),
            ("Mix pickup chimes", "audio"),
            ("Checkpoint lantern animation", "art"),
            ("Project scaffolding", "tech"),
            ("Main character silhouette", "art"),
            ("Input action map", "gameplay"),
            ("First snowy level blockout", "art"),
            ("UI paper palette", "ui"),
            ("Lantern pickup prototype", "gameplay"),
            ("Export preset: Windows", "tech"),
        ];
        let mut keys = Vec::new();
        for (i, (name, tag)) in titles.iter().enumerate() {
            let status = match i {
                0..=5 => "backlog",
                6..=14 => "todo",
                15..=20 => "in_progress",
                21..=24 => "review",
                _ => "done",
            };
            let task=self.create_task(&danil.id,CreateTask{
title:(*name).into(),description:Some(format!("## Goal\n\n{name}. Keep the experience warm, readable, and small enough for the jam.\n\n- [ ] Implement\n- [ ] Playtest")),status:Some(status.into()),priority:Some(if i==6{
"critical"}
else if i%5==0{
"high"}
else{
"medium"}
.into()),tags:Some(vec![(*tag).into()]),estimate:Some([1,2,3,5,8][i%5]),..Default::default()}
)?;
            keys.push(task.task.key);
        }
        self.claim_task(&codex.id, &keys[15])?;
        self.claim_task(&claude.id, &keys[18])?;
        self.claim_task(&codex.id, &keys[20])?;
        for i in [6, 8, 21, 25, 30] {
            self.add_comment(&mira.id,&keys[i],"Playtested the latest build. The light cue feels good; please keep the transition gentle.")?;
        }
        let mut assets = Vec::new();
        for (kind, name, path) in [
            ("sprite", "Player", "assets/sprites/player.png"),
            ("sprite", "Lantern", "assets/sprites/lantern.png"),
            ("sprite", "Cabin tiles", "assets/sprites/cabin.png"),
            ("audio", "Snow footsteps", "assets/audio/snow-steps.wav"),
            ("audio", "Wind loop", "assets/audio/wind.ogg"),
            ("level", "Frozen bridge", "assets/levels/bridge.tscn"),
            ("font", "Menu font", "assets/fonts/menu.ttf"),
            ("other", "Palette", "assets/palette.png"),
        ] {
            assets.push(self.create_asset(
                &alex.id,
                kind,
                name,
                path,
                Some("Demo reference path; no file is copied."),
            )?);
        }
        for (i, a) in assets.iter().take(3).enumerate() {
            self.link_asset(&danil.id, &keys[i + 6], &a.id)?;
        }
        for i in [7, 8, 9, 10] {
            self.assign_task(
                &danil.id,
                &keys[i],
                Some(if i % 2 == 0 { &mira.id } else { &alex.id }),
            )?;
        }
        // Reused agents already have their join event. Keep exactly 60 demo events
        // with additional handoff comments on one of the same five commented tasks.
        let count = self.read(|c| {
            Ok(c.query_row(
                "SELECT count(*) FROM activity WHERE jam_id=? AND seq>?",
                params![j.id, before],
                |r| r.get::<_, i64>(0),
            )?)
        })?;
        for _ in count..60 {
            self.add_comment(
                &danil.id,
                &keys[6],
                "Demo handoff: the agents and task context are ready for the next jam session.",
            )?;
        }
        // Backdate only this fixture's events, leaving other jams' history intact.
        self.write(|c| {
            let sequences = c
                .prepare("SELECT seq FROM activity WHERE jam_id=? AND seq>? ORDER BY seq")?
                .query_map(params![j.id, before], |r| r.get::<_, i64>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for (i, seq) in sequences.iter().enumerate() {
                let stamp = (time::OffsetDateTime::now_utc()
                    - time::Duration::seconds(
                        17 * 3600 * (sequences.len() - i) as i64 / sequences.len() as i64,
                    ))
                .format(&time::format_description::well_known::Rfc3339)
                .expect("UTC");
                c.execute(
                    "UPDATE activity SET created_at=? WHERE seq=?",
                    params![stamp, seq],
                )?;
            }
            Ok(())
        })?;
        self.active_jam()
    }
}
