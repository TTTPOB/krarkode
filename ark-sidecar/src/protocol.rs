use serde::Serialize;
use serde_json::Value;
use tracing::{debug, error};

#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub(crate) enum SidecarEvent {
    LspPort {
        port: u16,
    },
    Error {
        message: String,
    },
    KernelStatus {
        status: String,
    },
    Alive,
    CommOpen {
        comm_id: String,
        target_name: String,
        data: Value,
    },
    UiCommOpen {
        comm_id: String,
        target_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    HelpCommOpen {
        comm_id: String,
        target_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    VariablesCommOpen {
        comm_id: String,
        target_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    DataExplorerCommOpen {
        comm_id: String,
        target_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    CommMsg {
        comm_id: String,
        data: Value,
    },
    CommClose {
        comm_id: String,
    },
    ShowHtmlFile {
        comm_id: String,
        data: Value,
    },
    ShowHelp {
        comm_id: String,
        data: Value,
    },
    DisplayData {
        data: String,
        display_id: Option<String>,
    },
    UpdateDisplayData {
        data: String,
        display_id: Option<String>,
    },
}

pub(crate) fn emit_event(event: SidecarEvent) {
    debug!(event = ?event, "Sidecar: emitting event");
    match serde_json::to_string(&event) {
        Ok(payload) => println!("{payload}"),
        Err(err) => error!(error = ?err, "Sidecar: failed to serialize event"),
    }
}
