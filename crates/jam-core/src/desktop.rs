use crate::*;
use rusqlite::OptionalExtension;

impl Store {
    pub fn current_member(&self) -> Result<Member> {
        let id = self.setting("current_member_id")?.ok_or_else(|| {
            invalid(
                "currentMember",
                "Choose who you are before changing the board",
            )
        })?;
        let member = self.get_member(&id)?;
        if member.kind != "human" {
            return Err(invalid(
                "currentMember",
                "The desktop identity must be a human",
            ));
        }
        Ok(member)
    }
    pub fn app_state(&self) -> Result<AppState> {
        let jam = match self.active_jam() {
            Ok(j) => Some(j),
            Err(Error::NotFound(_)) => None,
            Err(e) => return Err(e),
        };
        let current_member = match self.current_member() {
            Ok(m) => Some(m),
            Err(Error::NotFound(_) | Error::Validation { .. }) => None,
            Err(e) => return Err(e),
        };
        Ok(AppState {
            has_jam: jam.is_some(),
            current_member,
            jam,
            theme: self.setting("theme")?.unwrap_or_else(|| "system".into()),
        })
    }
    pub fn set_current_member(&self, id: &str) -> Result<AppState> {
        let member = self.get_member(id)?;
        if member.kind != "human" {
            return Err(invalid("memberId", "Choose a human member"));
        }
        self.set_setting("current_member_id", id)?;
        self.app_state()
    }
    pub fn join_as_human(&self, name: &str) -> Result<AppState> {
        if !(1..=40).contains(&name.trim().chars().count()) {
            return Err(invalid("yourName", "Use 1–40 characters"));
        }
        let actor = self
            .list_members()?
            .into_iter()
            .find(|m| m.member.kind == "human")
            .ok_or_else(|| Error::NotFound("a human jam owner".into()))?
            .member;
        let used = self
            .list_members()?
            .into_iter()
            .map(|m| m.member.color)
            .collect::<Vec<_>>();
        let color = MEMBER_COLORS
            .iter()
            .find(|c| !used.iter().any(|u| u == **c))
            .copied()
            .unwrap_or(MEMBER_COLORS[0]);
        let member = self.add_human(&actor.id, name.trim(), color, None)?;
        self.set_current_member(&member.id)
    }
    pub fn onboard(&self, input: NewJamInput) -> Result<AppState> {
        if !(1..=60).contains(&input.name.trim().chars().count()) {
            return Err(invalid("name", "Use 1–60 characters"));
        }
        if !(1..=40).contains(&input.your_name.trim().chars().count()) {
            return Err(invalid("yourName", "Use 1–40 characters"));
        }
        let format = &time::format_description::well_known::Rfc3339;
        let start = time::OffsetDateTime::parse(&input.starts_at, format)
            .map_err(|_| invalid("startsAt", "Use a valid date and time"))?;
        let end = time::OffsetDateTime::parse(&input.ends_at, format)
            .map_err(|_| invalid("endsAt", "Use a valid date and time"))?;
        if end <= start {
            return Err(invalid("endsAt", "End must be after start"));
        }
        self.create_jam(
            input.name.trim(),
            input.theme.as_deref(),
            Some(&input.starts_at),
            Some(&input.ends_at),
            &input.timezone,
            input.your_name.trim(),
        )?;
        self.app_state()
    }
    pub fn set_theme(&self, theme: &str) -> Result<()> {
        if !["system", "light", "dark"].contains(&theme) {
            return Err(invalid("theme", "Choose system, light or dark"));
        }
        self.set_setting("theme", theme)
    }
    pub fn board_summary(&self) -> Result<BoardSummary> {
        Ok(serde_json::from_value(self.board(
            self.current_member().ok().as_ref().map(|m| m.id.as_str()),
        )?)?)
    }
    pub fn list_board_tasks(&self) -> Result<BoardTasks> {
        self.read(|c|{
            let j=crate::service::jam(c)?;
            let keys=c.prepare("SELECT key FROM tasks WHERE jam_id=? AND archived_at IS NULL ORDER BY position,key")?.query_map([j.id],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            let mut groups=STATUSES.into_iter().map(|s|(s.into(),Vec::new())).collect::<BoardTasks>();
            for key in keys{let t=crate::service::task(c,&key)?;groups.get_mut(&t.status).expect("validated status").push(t);}
            Ok(groups)
        })
    }
    pub fn list_activity(
        &self,
        after: Option<i64>,
        limit: Option<i64>,
    ) -> Result<Vec<ActivityEvent>> {
        let limit = limit.unwrap_or(50);
        if !(1..=2000).contains(&limit) {
            return Err(invalid("limit", "Use 1–2000"));
        }
        self.read(|c| {
            let j = crate::service::jam(c)?;
            let events = crate::db::activity(c, after.unwrap_or(0), None, None)?;
            let mut filtered = Vec::new();
            for event in events {
                let event_jam = c
                    .query_row(
                        "SELECT jam_id FROM activity WHERE seq=?",
                        [event.seq],
                        |r| r.get::<_, Option<String>>(0),
                    )
                    .optional()?
                    .flatten();
                if event_jam.as_deref() == Some(&j.id) {
                    filtered.push(event);
                }
            }
            if after.is_some() {
                filtered.truncate(limit as usize);
            } else if filtered.len() > limit as usize {
                filtered.drain(..filtered.len() - limit as usize);
            }
            Ok(filtered)
        })
    }
    pub fn create_current_task(&self, input: CreateTask) -> Result<TaskDetail> {
        self.create_task(&self.current_member()?.id, input)
    }
    pub fn move_current_task(
        &self,
        key: &str,
        status: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<TaskSummary> {
        self.move_task(&self.current_member()?.id, key, status, before, after)
    }
}
