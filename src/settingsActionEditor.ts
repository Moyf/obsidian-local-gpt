import { Notice, Setting } from "obsidian";
import type LocalGPT from "./main";
import type { LocalGPTAction } from "./interfaces";
import { I18n } from "./i18n";
import { waitForAI } from "@obsidian-ai-providers/sdk";
import type {
	IAIProvider,
	IAIProvidersService,
} from "@obsidian-ai-providers/sdk";
import {
	isReasoningEffort,
	reasoningEffortOptionsFromSources,
	type ReasoningModeSource,
} from "./reasoningEffort";
import { ensureActionId } from "./actionUtils";

interface RenderActionEditorOptions {
	reasoningModes?: string[];
	reasoningModeSources?: ReasoningModeSource[];
	container: HTMLElement;
	plugin: LocalGPT;
	actionToEdit: LocalGPTAction;
	isExistingAction: boolean;
	closeActionEditor: (scrollAction?: LocalGPTAction) => void;
	addNewAction: (action: LocalGPTAction) => Promise<void>;
	dropCommunityLinkIfModified: (action: LocalGPTAction) => void;
}

export function renderActionEditor({
	reasoningModes = [],
	reasoningModeSources,
	container,
	plugin,
	actionToEdit,
	isExistingAction,
	closeActionEditor,
	addNewAction,
	dropCommunityLinkIfModified,
}: RenderActionEditorOptions) {
	new Setting(container)
		.setName(I18n.t("settings.actionName"))
		.addText((text) => {
			text.inputEl.classList.add("local-gpt-action-input");
			actionToEdit?.name && text.setValue(actionToEdit.name);
			text.setPlaceholder(I18n.t("settings.actionNamePlaceholder"));
			text.onChange(async (value) => {
				actionToEdit.name = value;
			});
		});

	new Setting(container)
		.setName(I18n.t("settings.systemPrompt"))
		.setDesc(I18n.t("settings.systemPromptDesc"))
		.addTextArea((text) => {
			text.inputEl.classList.add("local-gpt-action-textarea");
			actionToEdit?.system && text.setValue(actionToEdit.system);
			text.setPlaceholder(I18n.t("settings.systemPromptPlaceholder"));
			text.onChange(async (value) => {
				actionToEdit.system = value;
			});
		});

	const promptSetting = new Setting(container)
		.setName(I18n.t("settings.prompt"))
		.setDesc("")
		.addTextArea((text) => {
			text.inputEl.classList.add("local-gpt-action-textarea");
			actionToEdit?.prompt && text.setValue(actionToEdit.prompt);
			text.setPlaceholder("");
			text.onChange(async (value) => {
				actionToEdit.prompt = value;
			});
		});

	promptSetting.descEl.innerHTML = I18n.t("settings.promptDesc");

	new Setting(container)
		.setName(I18n.t("settings.replaceSelected"))
		.setDesc(I18n.t("settings.replaceSelectedDesc"))
		.addToggle((component) => {
			actionToEdit?.replace && component.setValue(actionToEdit.replace);
			component.onChange(async (value) => {
				actionToEdit.replace = value;
			});
		});

	const modeSources =
		reasoningModeSources ??
		reasoningModes.map((mode) => ({ mode, providerNames: [] }));
	const knownModes = modeSources.map((source) => source.mode);

	new Setting(container)
		.setName(I18n.t("settings.reasoningEffort"))
		.setDesc(I18n.t("settings.reasoningEffortDesc"))
		.addDropdown((dropdown) =>
			dropdown
				.addOption("", I18n.t("settings.reasoningEffortInherit"))
				.addOptions(reasoningEffortOptionsFromSources(modeSources))
				.addOptions(
					actionToEdit.reasoningEffort &&
						actionToEdit.reasoningEffort !== "default" &&
						!knownModes.includes(actionToEdit.reasoningEffort)
						? {
								[actionToEdit.reasoningEffort]: `${actionToEdit.reasoningEffort} (${I18n.t("settings.reasoningUnavailable")})`,
							}
						: {},
				)
				.setValue(actionToEdit.reasoningEffort ?? "")
				.onChange((value) => {
					if (
						(isReasoningEffort(value) &&
							knownModes.includes(value)) ||
						value === "default"
					) {
						actionToEdit.reasoningEffort = value;
					} else {
						delete actionToEdit.reasoningEffort;
					}
				}),
		);

	new Setting(container)
		.setName(I18n.t("settings.creativity"))
		.setDesc(I18n.t("settings.creativityDesc"))
		.addDropdown((dropdown) => {
			dropdown
				.addOption("inherit", I18n.t("settings.creativityInherit"))
				.addOption("default", I18n.t("settings.creativityDefault"))
				.addOption("0", I18n.t("settings.creativityNone"))
				.addOption("0.2", I18n.t("settings.creativityLow"))
				.addOption("0.5", I18n.t("settings.creativityMedium"))
				.addOption("1", I18n.t("settings.creativityHigh"));
			const value = actionToEdit.temperature;
			if (typeof value === "number" && ![0, 0.2, 0.5, 1].includes(value))
				dropdown.addOption(String(value), String(value));
			dropdown
				.setValue(
					value === undefined
						? "inherit"
						: value === null
							? "default"
							: String(value),
				)
				.onChange((selection) => {
					if (selection === "inherit")
						delete actionToEdit.temperature;
					else
						actionToEdit.temperature =
							selection === "default" ? null : Number(selection);
				});
		});

	// ── Per-action Provider/Model override (issue #108) ──
	const providerSetting = new Setting(container);
	const modelSetting = new Setting(container);
	const refreshModelOptions = (
		providerId: string,
		modelSelect: HTMLSelectElement,
	) => {
		const previous = actionToEdit.model ?? "";
		modelSelect.replaceChildren();
		const defaultOption = document.createElement("option");
		defaultOption.value = "";
		defaultOption.textContent = I18n.t("settings.actionModelDefault");
		modelSelect.appendChild(defaultOption);
		if (!providerId) {
			delete actionToEdit.model;
			return;
		}
		void (async () => {
			try {
				const aiRequestWaiter = await waitForAI();
				const aiProviders: IAIProvidersService =
					await aiRequestWaiter.promise;
				const provider = aiProviders.providers.find(
					(p: IAIProvider) => p.id === providerId,
				);
				if (!provider) return;
				const models: string[] =
					provider.availableModels ||
					(await aiProviders.fetchModels(provider));
				for (const model of models) {
					const option = document.createElement("option");
					option.value = model;
					option.textContent = model;
					modelSelect.appendChild(option);
				}
				if (previous && !models.includes(previous)) {
					const option = document.createElement("option");
					option.value = previous;
					option.textContent = `${previous} (${I18n.t("settings.actionModelUnavailable")})`;
					modelSelect.appendChild(option);
				}
				modelSelect.value = previous;
			} catch (error) {
				console.error("Error fetching models:", error);
			}
		})();
	};

	providerSetting
		.setName(I18n.t("settings.actionProvider"))
		.setDesc(I18n.t("settings.actionProviderDesc"))
		.addDropdown((dropdown) => {
			dropdown.addOption("", I18n.t("settings.actionProviderInherit"));
			void (async () => {
				try {
					const aiRequestWaiter = await waitForAI();
					const aiProviders: IAIProvidersService =
						await aiRequestWaiter.promise;
					const options: Record<string, string> = {};
					for (const provider of aiProviders.providers) {
						options[provider.id] = provider.model
							? [provider.name, provider.model].join(" ~ ")
							: provider.name;
					}
					dropdown.addOptions(options);
					dropdown.setValue(actionToEdit.providerId ?? "");
				} catch (error) {
					console.error("Error rendering provider override:", error);
				}
			})();
			dropdown.onChange((value) => {
				if (value) {
					actionToEdit.providerId = value;
				} else {
					delete actionToEdit.providerId;
					delete actionToEdit.model;
				}
				refreshModelOptions(
					value,
					modelSetting.controlEl.querySelector(
						"select",
					) as HTMLSelectElement,
				);
			});
		});

	modelSetting
		.setName(I18n.t("settings.actionModel"))
		.setDesc(I18n.t("settings.actionModelDesc"))
		.addDropdown((dropdown) => {
			dropdown.addOption("", I18n.t("settings.actionModelDefault"));
			dropdown.onChange((value) => {
				if (value) {
					actionToEdit.model = value;
				} else {
					delete actionToEdit.model;
				}
			});
			if (actionToEdit.providerId) {
				refreshModelOptions(actionToEdit.providerId, dropdown.selectEl);
			}
		});
	// ── end per-action override ──
	const actionButtonsRow = new Setting(container).setName("");

	if (isExistingAction) {
		actionButtonsRow.addButton((button) => {
			button.setClass("local-gpt-action-remove");
			button
				.setButtonText(I18n.t("settings.remove"))
				.onClick(async () => {
					if (!button.buttonEl.hasClass("mod-warning")) {
						button.setClass("mod-warning");
						return;
					}

					plugin.settings.actions = plugin.settings.actions.filter(
						(innerAction) => innerAction !== actionToEdit,
					);
					await plugin.saveSettings();
					closeActionEditor();
				});
		});
	}

	actionButtonsRow
		.addButton((button) => {
			button.setButtonText(I18n.t("settings.close")).onClick(async () => {
				closeActionEditor(isExistingAction ? actionToEdit : undefined);
			});
		})
		.addButton((button) =>
			button
				.setCta()
				.setButtonText(I18n.t("settings.save"))
				.onClick(async () => {
					if (!actionToEdit.name) {
						new Notice(I18n.t("notices.actionNameRequired"));
						return;
					}
					const actionToSave = ensureActionId(actionToEdit);

					if (!isExistingAction) {
						if (
							plugin.settings.actions.find(
								(action) => action.name === actionToSave.name,
							)
						) {
							new Notice(
								I18n.t("notices.actionNameExists", {
									name: actionToSave.name,
								}),
							);
							return;
						}

						await addNewAction(actionToSave);
					} else {
						if (
							plugin.settings.actions.filter(
								(action) => action.name === actionToSave.name,
							).length > 1
						) {
							new Notice(
								I18n.t("notices.actionNameExists", {
									name: actionToSave.name,
								}),
							);
							return;
						}

						dropCommunityLinkIfModified(actionToSave);

						const index = plugin.settings.actions.findIndex(
							(innerAction) => innerAction === actionToEdit,
						);

						if (index >= 0) {
							plugin.settings.actions[index] = actionToSave;
						}
					}

					await plugin.saveSettings();
					closeActionEditor(actionToSave);
				}),
		);
}
