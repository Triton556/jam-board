//! A coherent planning, worker and review session for the small lantern game.
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
        let lantern=self.create_epic(&danil.id,NewEpic{title:"Lantern levels".into(),goal_md:Some("Build a ten-minute cozy lantern game for keyboard and controller players. A fresh player should understand the snowy bridge without guessing.".into()),done_when_md:Some("The player reaches the cabin and completes the bridge on keyboard/controller. Mandatory story checks have recorded results.".into()),not_included_md:Some("No combat, online services, procedural worlds, inventory or new art direction.".into()),decided_md:Some("Preserve Danil's Godot prototype and paper palette. Keep one snowy route. Danil checks the first coherent sketch; Claude plans and reviews. The user chose gpt-6.1-sol for workers.".into()),participation:Some("first_sketch".into()),reviewer:Some("final".into()),worker_model:Some("gpt-6.1-sol".into()),..Default::default()})?;
        self.set_brain(&danil.id, &lantern.key, &claude.handle)?;
        self.set_epic_status(&danil.id, &lantern.key, "active", None)?;
        let menus = self.create_epic(
            &danil.id,
            NewEpic {
                title: "Title & menus".into(),
                goal_md: Some("Give the lantern game a clear opening and pause flow.".into()),
                ..Default::default()
            },
        )?;
        let mut stories = Vec::new();
        for (title, outcome, basis, preserve, risks) in [
            (
                "Movement and lantern readability",
                "Move and read the next safe step without fighting the controls.",
                "Danil's movement prototype and Mira's snow recording.",
                "Keep the jump arc, action names and quiet paper palette.",
                "Mushy jumps; glow hides the tile; footsteps mask the cue.",
            ),
            (
                "Bridge interactions",
                "Pickups and bridge tiles give immediate, understandable feedback.",
                "Alex's bridge blockout and the accepted lantern prototype.",
                "Keep one interact action, deterministic checkpoints and short transitions.",
                "Pickup triggers twice; collision traps the player; particles hide the tile.",
            ),
            (
                "Comfortable world",
                "The route remains calm and readable on keyboard and controller.",
                "Alex's snowy route and the current camera scene.",
                "Keep level geometry and the cozy visual system.",
                "Camera discomfort; cues rely only on hue; the route cannot be completed.",
            ),
        ] {
            let story=self.create_story(&danil.id,NewStory{epic_key:lantern.key.clone(),title:title.into(),outcome_md:Some(outcome.into()),basis_md:Some(basis.into()),preserve_md:Some(preserve.into()),scale_md:Some("Extend the existing prototype; do not replace the movement, level or rendering architecture.".into()),rejection_risks_md:Some(risks.into()),acceptance:Some(vec![Acceptance{id:"1".into(),criterion:outcome.into(),mandatory:true,check:"Run the named task tests and a keyboard/controller playtest from the cabin checkpoint.".into()},Acceptance{id:"2".into(),criterion:preserve.into(),mandatory:true,check:"Compare before/after and inspect input bindings and the paper palette.".into()}]),..Default::default()})?;
            self.set_story_status(&danil.id, &story.key, "active", None)?;
            stories.push(story);
        }
        stories.push(self.create_story(&danil.id,NewStory{epic_key:menus.key,title:"Menus and delivery".into(),outcome_md:Some("Players can start, pause and resume the lantern game.".into()),open_decisions_md:Some("Ask Danil which title illustration to preserve before activating this story.".into()),..Default::default()})?);
        let rows = [
            (
                "Cabin arrival: establish the first light",
                "game/levels/cabin.tscn",
                "Place one visible lantern pickup beside the cabin door.",
                "Start a game and approach the cabin door.",
                "The lantern is reachable and needs one interaction.",
                "art",
            ),
            (
                "Player movement: coyote time & jump buffer",
                "game/player/movement.gd",
                "Add 100ms coyote time and 120ms jump buffering without changing the jump arc.",
                "Jump 80ms after leaving a ledge and 100ms before landing.",
                "Both jumps trigger once; inputs outside the windows do not trigger delayed jumps.",
                "gameplay",
            ),
            (
                "Lantern glow shader",
                "game/shaders/lantern.gdshader",
                "Clamp glow to preserve snow edges; blend pickup intensity over 180ms.",
                "Hold the lantern beside white snow at both intensity extremes.",
                "Tile edges stay visible and no single-frame flash occurs.",
                "art",
            ),
            (
                "Bridge tile light cue",
                "game/bridge/tile_cue.gd",
                "Highlight only the adjacent safe tile while the lantern is held.",
                "Stand at the first tile and rotate between both branches.",
                "Exactly one adjacent safe tile lights up and follows the chosen branch.",
                "gameplay",
            ),
            (
                "SFX: footsteps on snow",
                "game/audio/footsteps.gd",
                "Alternate three snow clips with a 90ms minimum gap; suppress airborne steps.",
                "Walk, jump and stop on the bridge.",
                "Grounded steps are audible, never overlap above the gap limit and stop in the air.",
                "audio",
            ),
            (
                "Lantern battery curve",
                "game/lantern/battery.gd",
                "Use a 90-second charge curve with enough final light to find the checkpoint.",
                "Drain the lantern, then reload a checkpoint.",
                "Charge is monotonic, the final cue stays legible and reload restores charge.",
                "gameplay",
            ),
            (
                "Particles for light pickup",
                "game/fx/light_pickup.tscn",
                "Spawn six quiet sparks once per pickup and end them within 450ms.",
                "Collect one light while holding interact for one second.",
                "One burst appears, the safe tile stays visible and the emitter frees within 450ms.",
                "polish",
            ),
            (
                "Checkpoint lantern animation",
                "game/lantern/checkpoint.gd",
                "Persist activation before a gentle 240ms checkpoint fade.",
                "Activate the checkpoint, immediately quit and reload.",
                "The checkpoint remains active and the lantern never flashes.",
                "art",
            ),
            (
                "Snow bridge collision edges",
                "game/levels/bridge.tscn",
                "Close the two collision seams without moving the accepted art.",
                "Walk and jump over both seams at minimum speed.",
                "Neither seam snags the player or lets them fall through.",
                "bug",
            ),
            (
                "Wind loop and transitions",
                "game/audio/wind_bus.gd",
                "Crossfade cabin/bridge wind over 800ms without changing master volume.",
                "Cross the cabin boundary twice with headphones.",
                "There is no click, silence gap or doubled peak; master volume is unchanged.",
                "audio",
            ),
            (
                "Controller focus for lantern prompt",
                "game/ui/lantern_prompt.gd",
                "Display the current controller binding and refresh it after remapping.",
                "Connect a controller, remap interact and approach a lantern.",
                "The new binding appears; keyboard prompts still work.",
                "ui",
            ),
            (
                "Light pickup interaction",
                "game/lantern/pickup.gd",
                "Consume each pickup once, update charge atomically and ignore repeated input.",
                "Hold interact while entering and leaving a pickup area.",
                "Charge increases once and the pickup stays consumed after checkpoint reload.",
                "gameplay",
            ),
            (
                "Camera follow smoothing",
                "game/camera/follow.gd",
                "Cap camera catch-up distance after checkpoint reload using the existing spring.",
                "Run both directions and reload while moving.",
                "The camera never overshoots the route or exposes outside the level bounds.",
                "tech",
            ),
            (
                "Color-blind light indicators",
                "game/bridge/tile_cue.tscn",
                "Pair the existing hue with an outline and shape change; add no new colors.",
                "Compare safe/unsafe tiles in grayscale and reduced-motion mode.",
                "The safe tile is distinguishable without hue or pulse.",
                "ui",
            ),
            (
                "Project scaffolding",
                "project.godot",
                "Keep deterministic project defaults and document the local run command.",
                "Open a fresh checkout in the documented Godot version.",
                "The cabin starts without missing imports or online dependencies.",
                "tech",
            ),
            (
                "Input action map",
                "game/input/actions.gd",
                "Define move, jump, interact and pause once, preserving keyboard bindings.",
                "Inspect the input map and exercise every action on both devices.",
                "Each action has one definition and the same gameplay path on both devices.",
                "gameplay",
            ),
            (
                "First snowy level blockout",
                "game/levels/route.tscn",
                "Connect cabin and bridge with one readable route at the accepted tile scale.",
                "Walk from cabin to bridge and back.",
                "There is no unreachable step or dead end; existing tiles are preserved.",
                "art",
            ),
            (
                "Title screen layout",
                "game/ui/title.tscn",
                "Place Start and Quit below the title illustration after Danil confirms it.",
                "Open the title screen at the supported desktop viewport.",
                "Both actions are visible and keyboard focus follows visual order.",
                "ui",
            ),
            (
                "Pause menu",
                "game/ui/pause.gd",
                "Pause gameplay input while retaining menu focus; resume the current scene.",
                "Pause while walking, move menu focus, then resume.",
                "Movement stops while paused and resumes without a stuck input.",
                "ui",
            ),
            (
                "Save/load settings",
                "game/settings/store.gd",
                "Persist sound, input and accessibility locally with safe defaults.",
                "Change a setting, quit and reopen the game.",
                "The value is restored; a missing file uses defaults without crashing.",
                "tech",
            ),
            (
                "Credits screen",
                "game/ui/credits.tscn",
                "List people, fonts and tools with a clear Back action.",
                "Open credits and return by keyboard.",
                "Credits fit and Back restores the previous focus.",
                "ui",
            ),
            (
                "Export preset: Windows",
                "export_presets.cfg",
                "Add a reproducible Windows export using only included project assets.",
                "Export and launch a build in an empty output directory.",
                "The cabin loads with sound and no missing-asset errors.",
                "tech",
            ),
        ];
        let mut keys = Vec::new();
        for (i, (title, file, required, setup, expected, tag)) in rows.iter().enumerate() {
            let parent = if i < 6 {
                0
            } else if i < 12 {
                1
            } else if i < 17 {
                2
            } else {
                3
            };
            let status = if i == 0 || i >= 17 {
                "backlog"
            } else if (14..17).contains(&i) {
                "done"
            } else {
                "ready"
            };
            let task=self.create_task(&danil.id,CreateTask{title:(*title).into(),story_key:Some(stories[parent].key.clone()),description:Some("Keep free-form playtest notes here. The implementation contract is in the brief.".into()),status:Some(status.into()),priority:Some(if i==1{"critical"}else if i%5==0{"high"}else{"medium"}.into()),tags:Some(vec![(*tag).into()]),estimate:Some([1,2,3,5,8][i%5]),brief:TaskBrief{
                goal_md:format!("{required} Serve the cozy lantern route rather than building a separate prototype."),
                context_md:"The Godot project already has a cabin, snowy bridge and lantern prototype. Follow the story intent and preserve Danil's accepted visual direction.".into(),where_md:(*file).into(),
                changes:vec![Change{title:(*title).into(),now:"The prototype path exists but does not meet the named acceptance check.".into(),cause:"The jam needs a bounded change the reviewer can verify.".into(),required:(*required).into(),r#where:(*file).into(),follow:"Use adjacent scene/script conventions and the existing local test harness.".into(),keep:"Preserve input bindings, level geometry and the paper palette unless explicitly named in this change.".into()}],
                tests:vec![BriefTest{setup:(*setup).into(),expected:(*expected).into()},BriefTest{setup:"Repeat the interaction after checkpoint reload and with reduced motion enabled.".into(),expected:"State remains consistent and does not depend on animation or repeated input.".into()}],
                boundaries_md:"No hosted services, telemetry, new engine or broad refactor. Touch the named scene/script and focused tests. Ask before changing an agreed interaction.".into(),result_md:"Submit summaryMd, changedFiles, named tests (command, expected, actual, PASS/FAIL/NOT_RUN), deviationsMd and notVerifiedMd. Request brain review; never review your own work.".into(),user_quotes_md:String::new(),
            },..Default::default()})?;
            keys.push(task.task.key);
        }
        for index in [6, 8, 11] {
            self.seed_in_progress_sample(&j.id, &codex.id, &keys[index])?;
        }
        self.seed_in_progress_sample(&j.id, &danil.id, &keys[12])?;
        self.seed_in_progress_sample(&j.id, &alex.id, &keys[13])?;
        for index in [6, 8] {
            self.submit_report(
                &codex.id,
                SubmitReport {
                    key: keys[index].clone(),
                    expected_claim_generation: self.get_task(&keys[index])?.task.claim_generation,
                    summary_md: if index == 6 {
                        "The pickup effect exists, but repeated input spawns a second burst."
                    } else {
                        "The first seam is fixed; the second seam still catches a slow walk."
                    }
                    .into(),
                    changed_files: vec![rows[index].1.into()],
                    tests: vec![
                        ReportTest {
                            name: "1".into(),
                            command: "godot --headless --script tests/lantern_smoke.gd".into(),
                            expected: rows[index].4.into(),
                            actual: "The first interaction matches the expected result.".into(),
                            result: "PASS".into(),
                        },
                        ReportTest {
                            name: "2".into(),
                            command: "Manual checkpoint reload and repeated-input playtest".into(),
                            expected: "No duplicate burst or collision snag.".into(),
                            actual: "The repeated interaction fails at the second step.".into(),
                            result: "FAIL".into(),
                        },
                    ],
                    deviations_md: Some("No scope or dependency changes.".into()),
                    not_verified_md: Some("A second controller/computer was not available.".into()),
                },
            )?;
        }
        let observed = self.get_task(&keys[6])?;
        self.review_task(&claude.id,ReviewTask{key:keys[6].clone(),expected_report_id:observed.reports.last().unwrap().id.clone(),expected_review_context_revision:observed.review_context_revision.unwrap(),verdict:"changes_requested".into(),comments_md:"Preserve the first burst. Ignore repeated input until the pickup is consumed, then rerun test 2.".into(),failed_tests:Some(vec!["2".into()])})?;
        self.ask_user(&claude.id,AskUser{scope:Scope{kind:"epic".into(),id:lantern.key.clone()},title:"Should the safe tile cue stay steady?".into(),body_md:Some("A steady outline works without motion. A pulse needs an equivalent reduced-motion cue.".into()),options:Some(vec![QuestionOption{label:"Steady outline".into(),description:"Readable without movement; the smaller change.".into()},QuestionOption{label:"Gentle pulse".into(),description:"Adds motion with a steady fallback.".into()}]),recommended_index:Some(0),allow_free_text:Some(true),round_label:Some("Round 2".into())})?;
        self.ask_user(
            &codex.id,
            AskUser {
                scope: Scope {
                    kind: "task".into(),
                    id: keys[11].clone(),
                },
                title: "Which checkpoint owns a consumed pickup?".into(),
                body_md: Some(
                    "Keep it consumed for the route, or restore it only for a new game?".into(),
                ),
                options: None,
                recommended_index: None,
                allow_free_text: Some(true),
                round_label: None,
            },
        )?;
        self.set_status(
            &codex.id,
            "implementing JB-12",
            Some(Scope {
                kind: "task".into(),
                id: keys[11].clone(),
            }),
        )?;
        self.set_status(
            &claude.id,
            "reviewing JB-9",
            Some(Scope {
                kind: "task".into(),
                id: keys[8].clone(),
            }),
        )?;
        for (i, (kind, name, path)) in [
            ("sprite", "Player", "assets/sprites/player.png"),
            ("sprite", "Lantern", "assets/sprites/lantern.png"),
            ("sprite", "Cabin tiles", "assets/sprites/cabin.png"),
            ("audio", "Snow footsteps", "assets/audio/snow-steps.wav"),
            ("audio", "Wind loop", "assets/audio/wind.ogg"),
            ("level", "Frozen bridge", "assets/levels/bridge.tscn"),
            ("font", "Menu font", "assets/fonts/menu.ttf"),
            ("other", "Palette", "assets/palette.png"),
        ]
        .iter()
        .enumerate()
        {
            let asset = self.create_asset(
                &alex.id,
                kind,
                name,
                path,
                Some("The source file stays in the game project."),
            )?;
            if i < 3 {
                self.link_asset(&danil.id, &keys[i + 1], &asset.id)?;
            }
        }
        self.add_comment(
            &mira.id,
            &keys[4],
            "The snow recording leaves room for the lantern cue.",
        )?;
        self.write(|c| {
            let seqs = c
                .prepare("SELECT seq FROM activity WHERE jam_id=? AND seq>? ORDER BY seq")?
                .query_map(params![j.id, before], |r| r.get::<_, i64>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for (i, seq) in seqs.iter().enumerate() {
                let stamp = (time::OffsetDateTime::now_utc()
                    - time::Duration::seconds(
                        17 * 3600 * (seqs.len() - i) as i64 / seqs.len() as i64,
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

impl Store {
    /// Populate historical, synthetic sample cards, not live work or authority.
    /// This private fixture writer is used only while creating a brand-new demo.
    /// The ordinary claim API always enforces the gate; the demo has no grants.
    fn seed_in_progress_sample(&self, project: &str, actor: &str, key: &str) -> Result<()> {
        self.write(|c| {
            let t=crate::service::task(c,key)?;
            if t.jam_id!=project {return Err(invalid("demo","A sample must belong to the newly created demo"));}
            c.execute("UPDATE tasks SET assignee_id=?,status='in_progress',position=(SELECT coalesce(max(position),0)+1024 FROM tasks WHERE jam_id=? AND status='in_progress') WHERE id=?",params![actor,project,t.id])?;
            crate::service::touch(c,&t.id,actor)?;
            crate::service::event(c,Some(project),actor,"task.claimed",Some(&t.id),serde_json::json!({"assigneeId":[t.assignee_id,actor],"status":[t.status,"in_progress"]}))
        })
    }
}
