import { ProviderConnectionsPanel } from "@/components/provider-connections-panel";
import { ProviderDiagnosticsPanel } from "@/components/provider-diagnostics-panel";

const DEFAULT_PROVIDERS_TITLE = "Connect Providers";
const DEFAULT_PROVIDERS_DESCRIPTION =
	"Connect Doubao, DeepSeek, Yuanbao, and Qwen in their persistent local browser profiles.";
const DEFAULT_PROVIDERS_HELPER_TEXT =
	"Complete login or verification in the provider window. The collector reuses the same profile for future runs.";

export function ProvidersScreen(props: {
	title?: string | null;
	description?: string | null;
	helperText?: string | null;
	nextHref?: string | null;
	showSetupNotice?: boolean;
	workspaceId?: string | null;
	showOnboardingActions?: boolean;
	watchForExternalUpdates?: boolean;
}) {
	const {
		title = DEFAULT_PROVIDERS_TITLE,
		description = DEFAULT_PROVIDERS_DESCRIPTION,
		helperText = DEFAULT_PROVIDERS_HELPER_TEXT,
		nextHref = null,
		showSetupNotice = true,
		workspaceId = null,
		showOnboardingActions = false,
		watchForExternalUpdates = false,
	} = props;

	return (
		<div className="flex min-h-full min-w-0 items-center justify-center overflow-x-hidden px-4 pt-5 pb-9 sm:px-8 sm:pt-7 sm:pb-11 lg:px-10">
			<div className="ui-stagger w-full max-w-4xl xl:max-w-5xl">
				<ProviderConnectionsPanel
					title={title}
					description={description}
					helperText={helperText}
					nextHref={nextHref}
					showSetupNotice={showSetupNotice}
					workspaceId={workspaceId}
					showOnboardingActions={showOnboardingActions}
					watchForExternalUpdates={watchForExternalUpdates}
				/>
				{workspaceId ? (
					<ProviderDiagnosticsPanel workspaceId={workspaceId} />
				) : null}
			</div>
		</div>
	);
}
