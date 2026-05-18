<template>
  <div class="template-overrides-section">
    <div class="section-header">
      <h2 class="section-title">{{ $t("social.templateOverrides.title") }}</h2>
      <p class="section-description">{{ $t("social.templateOverrides.description") }}</p>
    </div>

    <div v-if="loading" class="loading-state mono">{{ $t("common.loading") }}</div>

    <div v-else class="overrides-layout">
      <!-- Left: template list -->
      <div class="template-list">
        <button
          v-for="tpl in templates"
          :key="tpl.templateKey"
          class="template-item"
          :class="{ active: selectedKey === tpl.templateKey }"
          @click="selectTemplate(tpl.templateKey)"
        >
          <div class="template-item-name">{{ $t(`social.templateOverrides.templates.${tpl.templateKey}`) as string }}</div>
          <div class="template-item-meta">
            <span v-if="tpl.hasCustomOverrides" class="custom-badge">{{ $t("social.templateOverrides.customBadge") }}</span>
            <span v-else class="defaults-label">{{ $t("social.templateOverrides.useDefaults") }}</span>
          </div>
        </button>
      </div>

      <!-- Right: editor pane -->
      <div class="editor-pane">
        <div v-if="!selectedKey" class="no-selection mono">
          {{ $t("social.templateOverrides.noneSelected") }}
        </div>

        <template v-else>
          <div class="editor-header">
            <h3 class="editor-title">{{ $t(`social.templateOverrides.templates.${selectedKey}`) as string }}</h3>
            <button
              v-if="selectedOverride?.hasCustomOverrides"
              class="reset-btn"
              :disabled="resetting"
              @click="confirmReset"
            >
              {{ $t("social.templateOverrides.resetToDefaults") }}
            </button>
          </div>

          <!-- Section tabs -->
          <div class="section-tabs" role="tablist">
            <button
              v-for="sec in sectionOptions"
              :key="sec.value"
              class="section-tab"
              :class="{ active: activeSection === sec.value }"
              role="tab"
              :aria-selected="activeSection === sec.value"
              @click="setSection(sec.value)"
            >
              {{ sec.label }}
            </button>
          </div>

          <!-- Copy section -->
          <div v-if="activeSection === 'copy'" class="override-fields">
            <!-- comparison-stunning / comparison-stunning-3 -->
            <template v-if="selectedKey === 'comparison-stunning' || selectedKey === 'comparison-stunning-3'">
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.coverEyebrowLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.coverEyebrowLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.coverEyebrowLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.deepDiveEyebrow") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.deepDiveEyebrow.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.deepDiveEyebrow.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaSaveLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaSaveSubline") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveSubline.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveSubline.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaFollowLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaFollowLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaFollowLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.perfektFürLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.perfektFürLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.perfektFürLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.toolsRecapLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.toolsRecapLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.toolsRecapLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.forLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.forLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.forLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
            </template>

            <!-- single-tool-spotlight -->
            <template v-else-if="selectedKey === 'single-tool-spotlight'">
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.hookQuestion") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.coverSlide.hookQuestion.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.coverSlide.hookQuestion.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.promiseLine1") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine1.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine1.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.promiseLine2") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine2.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine2.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.strengthsEyebrow") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.strengthsSlide.strengthsEyebrow.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.strengthsSlide.strengthsEyebrow.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.topStrengthLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.strengthsSlide.topStrengthLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.strengthsSlide.topStrengthLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.weaknessesLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.strengthsSlide.weaknessesLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.strengthsSlide.weaknessesLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.pricingEyebrow") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.pricingSlide.pricingEyebrow.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.pricingSlide.pricingEyebrow.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.forWhomLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.pricingSlide.forWhomLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.pricingSlide.forWhomLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.skipIfLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.pricingSlide.skipIfLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.pricingSlide.skipIfLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.useCasesHeadline") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.useCaseSlide.useCasesHeadline.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.useCaseSlide.useCasesHeadline.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaSaveLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaSaveSubline") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveSubline.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveSubline.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaFollowLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaFollowLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaFollowLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
            </template>

            <!-- use-case-verdict-per-tool -->
            <template v-else-if="selectedKey === 'use-case-verdict-per-tool'">
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.promiseLine1") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine1.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine1.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.promiseLine2") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine2.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.coverSlide.promiseLine2.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.winnerLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.verdictSlide.winnerLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.verdictSlide.winnerLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.overallResultLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.recapSlide.overallResultLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.recapSlide.overallResultLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.whoWinsLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.recapSlide.whoWinsLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.recapSlide.whoWinsLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.allVerdictsLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.recapSlide.allVerdictsLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.recapSlide.allVerdictsLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaSaveLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaSaveSubline") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveSubline.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaSaveSubline.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
              <div class="copy-field-row">
                <span class="copy-field-label">{{ $t("social.templateOverrides.copy.ctaFollowLabel") }}</span>
                <div class="locale-inputs">
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.deLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaFollowLabel.de" class="text-input" autocomplete="off" />
                  </div>
                  <div class="locale-input-wrap">
                    <span class="locale-tag">{{ $t("social.templateOverrides.enLabel") }}</span>
                    <input v-model="form.copy.endSlide.ctaFollowLabel.en" class="text-input" autocomplete="off" />
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Layout section -->
          <div v-if="activeSection === 'layout'" class="override-fields">
            <!-- comparison-stunning / comparison-stunning-3 -->
            <template v-if="selectedKey === 'comparison-stunning' || selectedKey === 'comparison-stunning-3'">
              <label
                v-for="field in comparisonLayoutFields"
                :key="field"
                class="toggle-row"
              >
                <input type="checkbox" v-model="form.layout[field]" class="toggle-check" />
                <span>{{ $t(`social.templateOverrides.layout.${field}`) as string }}</span>
              </label>
            </template>

            <!-- single-tool-spotlight -->
            <template v-else-if="selectedKey === 'single-tool-spotlight'">
              <label
                v-for="field in spotlightLayoutFields"
                :key="field"
                class="toggle-row"
              >
                <input type="checkbox" v-model="form.layout[field]" class="toggle-check" />
                <span>{{ $t(`social.templateOverrides.layout.${field}`) as string }}</span>
              </label>
            </template>

            <!-- use-case-verdict-per-tool -->
            <template v-else-if="selectedKey === 'use-case-verdict-per-tool'">
              <label
                v-for="field in verdictLayoutFields"
                :key="field"
                class="toggle-row"
              >
                <input type="checkbox" v-model="form.layout[field]" class="toggle-check" />
                <span>{{ $t(`social.templateOverrides.layout.${field}`) as string }}</span>
              </label>
            </template>
          </div>

          <!-- Eligibility section -->
          <div v-if="activeSection === 'eligibility'" class="override-fields">
            <template v-if="selectedKey === 'comparison-stunning' || selectedKey === 'comparison-stunning-3'">
              <p class="eligibility-empty mono">—</p>
            </template>

            <template v-else-if="selectedKey === 'single-tool-spotlight'">
              <div class="eligibility-row">
                <label class="eligibility-label">{{ $t("social.templateOverrides.eligibility.minProsCount") }}</label>
                <input
                  type="number"
                  v-model.number="form.eligibility.minProsCount"
                  class="number-input"
                  min="1"
                  max="10"
                />
              </div>
              <div class="eligibility-row">
                <label class="eligibility-label">{{ $t("social.templateOverrides.eligibility.maxProsCount") }}</label>
                <input
                  type="number"
                  v-model.number="form.eligibility.maxProsCount"
                  class="number-input"
                  min="1"
                  max="10"
                />
              </div>
              <div class="eligibility-row">
                <label class="eligibility-label">{{ $t("social.templateOverrides.eligibility.useCaseSlideThreshold") }}</label>
                <input
                  type="number"
                  v-model.number="form.eligibility.useCaseSlideThreshold"
                  class="number-input"
                  min="0"
                  max="10"
                />
              </div>
            </template>

            <template v-else-if="selectedKey === 'use-case-verdict-per-tool'">
              <div class="eligibility-row">
                <label class="eligibility-label">{{ $t("social.templateOverrides.eligibility.minVerdictsCount") }}</label>
                <input
                  type="number"
                  v-model.number="form.eligibility.minVerdictsCount"
                  class="number-input"
                  min="2"
                  max="10"
                />
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="editor-footer">
            <span v-if="dirty && !saving" class="footer-status mono">● {{ $t("forms.unsavedChanges") }}</span>
            <span v-if="saving" class="footer-status mono">{{ $t("forms.saving") }}</span>
            <div class="footer-actions">
              <button v-if="dirty && !saving" class="btn-ghost" @click="cancelChanges">
                {{ $t("common.cancel") }}
              </button>
              <button class="btn-primary" :disabled="!dirty || saving" @click="save">
                {{ $t("common.save") }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiPut, apiDelete } from "src/lib/api";

type LocalizedString = { de: string; en: string };

type OverrideRow = {
  templateKey: string;
  hasCustomOverrides: boolean;
  values: Record<string, unknown>;
  lastUsedAt: string | null;
  updatedAt: string | null;
};

export default defineComponent({
  name: "TemplateOverridesSection",

  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    loading: false,
    saving: false,
    resetting: false,
    templates: [] as OverrideRow[],
    selectedKey: "" as string,
    originalValues: null as Record<string, unknown> | null,
    // The active editor form — shape varies per selectedKey; typed loosely to allow dynamic nesting
    form: {
      // biome-ignore lint/suspicious/noExplicitAny: form shape is template-key-dependent; validated at save time
      copy: {} as Record<string, any>,
      layout: {} as Record<string, boolean>,
      eligibility: {} as Record<string, number>,
    },
    activeSection: "layout" as "copy" | "layout" | "eligibility",
    comparisonLayoutFields: [
      "includeEndSlide",
      "showRankBadge",
      "showPricingChip",
      "showToolRecap",
      "showSavePrompt",
      "showFollowCTA",
      "showArticleLink",
    ] as string[],
    spotlightLayoutFields: [
      "includeEndSlide",
      "showSavePrompt",
      "showFollowCTA",
      "showArticleLink",
      "showPricingChip",
    ] as string[],
    verdictLayoutFields: [
      "includeEndSlide",
      "includeRecapSlide",
      "showSavePrompt",
      "showFollowCTA",
      "showArticleLink",
    ] as string[],
  }),

  computed: {
    selectedOverride(): OverrideRow | undefined {
      return this.templates.find((t) => t.templateKey === this.selectedKey);
    },

    dirty(): boolean {
      return JSON.stringify(this.form) !== JSON.stringify(this.originalValues);
    },

    sectionOptions(): Array<{ value: string; label: string }> {
      return [
        { value: "copy", label: this.$t("social.templateOverrides.sections.copy") as string },
        { value: "layout", label: this.$t("social.templateOverrides.sections.layout") as string },
        { value: "eligibility", label: this.$t("social.templateOverrides.sections.eligibility") as string },
      ];
    },
  },

  mounted() {
    void this.load();
  },

  methods: {
    async load(): Promise<void> {
      this.loading = true;
      try {
        const data = await apiGet<OverrideRow[]>(`/projects/${this.slug}/template-overrides`);
        this.templates = data;
        if (data.length > 0 && !this.selectedKey) {
          this.selectTemplate(data[0]!.templateKey);
        }
      } finally {
        this.loading = false;
      }
    },

    selectTemplate(key: string): void {
      this.selectedKey = key;
      this.activeSection = "layout";
      const row = this.templates.find((t) => t.templateKey === key);
      const values = (row?.values ?? {}) as Record<string, unknown>;
      this.initForm(key, values);
    },

    initForm(key: string, values: Record<string, unknown>): void {
      let form: typeof this.form;

      if (key === "comparison-stunning" || key === "comparison-stunning-3") {
        const copy = (values.copy ?? {}) as Record<string, unknown>;
        const endSlide = (copy.endSlide ?? {}) as Record<string, unknown>;
        form = {
          copy: {
            coverEyebrowLabel: this.loc(copy.coverEyebrowLabel, "TOOL-VERGLEICH", "TOOL COMPARISON"),
            deepDiveEyebrow: this.loc(copy.deepDiveEyebrow, "ZUR VERTIEFUNG", "DIVE DEEPER"),
            endSlide: {
              ctaSaveLabel: this.loc(endSlide.ctaSaveLabel, "Speichere diesen Post", "Save this post"),
              ctaSaveSubline: this.loc(endSlide.ctaSaveSubline, "als Cheat-Sheet für deinen nächsten Tool-Vergleich", "as your tool-comparison cheat sheet"),
              ctaFollowLabel: this.loc(endSlide.ctaFollowLabel, "Mehr ehrliche Vergleiche", "More honest reviews"),
              perfektFürLabel: this.loc(endSlide.perfektFürLabel, "Perfekt für", "Perfect for"),
              toolsRecapLabel: this.loc(endSlide.toolsRecapLabel, "Tools im Detail", "Tools in detail"),
              forLabel: this.loc(endSlide.forLabel, "für ", "for "),
            },
          },
          layout: this.bools(values.layout, ["includeEndSlide", "showRankBadge", "showPricingChip", "showToolRecap", "showSavePrompt", "showFollowCTA", "showArticleLink"], true),
          eligibility: {},
        };
      } else if (key === "single-tool-spotlight") {
        const copy = (values.copy ?? {}) as Record<string, unknown>;
        const coverSlide = (copy.coverSlide ?? {}) as Record<string, unknown>;
        const strengthsSlide = (copy.strengthsSlide ?? {}) as Record<string, unknown>;
        const pricingSlide = (copy.pricingSlide ?? {}) as Record<string, unknown>;
        const useCaseSlide = (copy.useCaseSlide ?? {}) as Record<string, unknown>;
        const endSlide = (copy.endSlide ?? {}) as Record<string, unknown>;
        const elig = (values.eligibility ?? {}) as Record<string, unknown>;
        form = {
          copy: {
            coverSlide: {
              hookQuestion: this.loc(coverSlide.hookQuestion, "lohnt es sich?", "worth it?"),
              promiseLine1: this.loc(coverSlide.promiseLine1, "Stärken & Schwächen", "Strengths & weaknesses"),
              promiseLine2: this.loc(coverSlide.promiseLine2, "Ehrlich. Ohne Hype.", "No hype answers."),
            },
            strengthsSlide: {
              strengthsEyebrow: this.loc(strengthsSlide.strengthsEyebrow, "STÄRKEN", "STRENGTHS"),
              topStrengthLabel: this.loc(strengthsSlide.topStrengthLabel, "Top-Stärke", "Top strength"),
              weaknessesLabel: this.loc(strengthsSlide.weaknessesLabel, "Schwächen", "Weaknesses"),
            },
            pricingSlide: {
              pricingEyebrow: this.loc(pricingSlide.pricingEyebrow, "PRICING & FÜR WEN", "PRICING & FOR WHOM"),
              forWhomLabel: this.loc(pricingSlide.forWhomLabel, "Perfekt für", "Perfect for"),
              skipIfLabel: this.loc(pricingSlide.skipIfLabel, "Weniger geeignet wenn…", "Skip if…"),
            },
            useCaseSlide: {
              useCasesHeadline: this.loc(useCaseSlide.useCasesHeadline, "Wofür?", "Best for?"),
            },
            endSlide: {
              ctaSaveLabel: this.loc(endSlide.ctaSaveLabel, "Speichere diesen Post", "Save this post"),
              ctaSaveSubline: this.loc(endSlide.ctaSaveSubline, "für deinen nächsten Tool-Check", "for your next tool check"),
              ctaFollowLabel: this.loc(endSlide.ctaFollowLabel, "Mehr ehrliche Reviews", "More honest reviews"),
            },
          },
          layout: this.bools(values.layout, ["includeEndSlide", "showSavePrompt", "showFollowCTA", "showArticleLink", "showPricingChip"], true),
          eligibility: {
            minProsCount: typeof elig.minProsCount === "number" ? elig.minProsCount : 2,
            maxProsCount: typeof elig.maxProsCount === "number" ? elig.maxProsCount : 5,
            useCaseSlideThreshold: typeof elig.useCaseSlideThreshold === "number" ? elig.useCaseSlideThreshold : 3,
          },
        };
      } else {
        // use-case-verdict-per-tool
        const copy = (values.copy ?? {}) as Record<string, unknown>;
        const coverSlide = (copy.coverSlide ?? {}) as Record<string, unknown>;
        const verdictSlide = (copy.verdictSlide ?? {}) as Record<string, unknown>;
        const recapSlide = (copy.recapSlide ?? {}) as Record<string, unknown>;
        const endSlide = (copy.endSlide ?? {}) as Record<string, unknown>;
        const elig = (values.eligibility ?? {}) as Record<string, unknown>;
        form = {
          copy: {
            coverSlide: {
              promiseLine1: this.loc(coverSlide.promiseLine1, "Wer gewinnt für welchen Use-Case?", "Who wins which use case?"),
              promiseLine2: this.loc(coverSlide.promiseLine2, "Klare Empfehlungen.", "Clear recommendations."),
            },
            verdictSlide: {
              winnerLabel: this.loc(verdictSlide.winnerLabel, "GEWINNT", "WINS"),
            },
            recapSlide: {
              overallResultLabel: this.loc(recapSlide.overallResultLabel, "GESAMT-ERGEBNIS", "OVERALL RESULT"),
              whoWinsLabel: this.loc(recapSlide.whoWinsLabel, "Wer gewinnt?", "Who wins?"),
              allVerdictsLabel: this.loc(recapSlide.allVerdictsLabel, "Alle Verdicts", "All verdicts"),
            },
            endSlide: {
              ctaSaveLabel: this.loc(endSlide.ctaSaveLabel, "Speichere diesen Post", "Save this post"),
              ctaSaveSubline: this.loc(endSlide.ctaSaveSubline, "für deine nächste Use-Case-Entscheidung", "for your next use-case decision"),
              ctaFollowLabel: this.loc(endSlide.ctaFollowLabel, "Mehr ehrliche Vergleiche", "More honest reviews"),
            },
          },
          layout: this.bools(values.layout, ["includeEndSlide", "includeRecapSlide", "showSavePrompt", "showFollowCTA", "showArticleLink"], true),
          eligibility: {
            minVerdictsCount: typeof elig.minVerdictsCount === "number" ? elig.minVerdictsCount : 3,
          },
        };
      }

      this.form = form;
      this.originalValues = JSON.parse(JSON.stringify(form)) as Record<string, unknown>;
    },

    loc(raw: unknown, de: string, en: string): LocalizedString {
      const obj = raw as Record<string, unknown> | null | undefined;
      return {
        de: typeof obj?.de === "string" ? obj.de : de,
        en: typeof obj?.en === "string" ? obj.en : en,
      };
    },

    bools(raw: unknown, keys: string[], defaultVal: boolean): Record<string, boolean> {
      const obj = raw as Record<string, unknown> | null | undefined;
      const result: Record<string, boolean> = {};
      for (const k of keys) {
        result[k] = typeof obj?.[k] === "boolean" ? (obj[k] as boolean) : defaultVal;
      }
      return result;
    },

    setSection(value: string): void {
      if (value === "copy" || value === "layout" || value === "eligibility") {
        this.activeSection = value;
      }
    },

    cancelChanges(): void {
      if (this.originalValues) {
        this.form = JSON.parse(JSON.stringify(this.originalValues)) as typeof this.form;
      }
    },

    async save(): Promise<void> {
      if (!this.selectedKey || !this.dirty) return;
      this.saving = true;
      try {
        await apiPut(`/projects/${this.slug}/template-overrides/${this.selectedKey}`, {
          values: this.form,
        });
        this.originalValues = JSON.parse(JSON.stringify(this.form)) as Record<string, unknown>;
        const idx = this.templates.findIndex((t) => t.templateKey === this.selectedKey);
        if (idx !== -1) {
          this.templates[idx] = { ...this.templates[idx]!, hasCustomOverrides: true, updatedAt: new Date().toISOString() };
        }
        this.$q.notify({ type: "positive", message: this.$t("common.saved") as string, timeout: 2000 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.saving = false;
      }
    },

    confirmReset(): void {
      if (!confirm(this.$t("social.templateOverrides.resetConfirm") as string)) return;
      void this.reset();
    },

    async reset(): Promise<void> {
      if (!this.selectedKey) return;
      this.resetting = true;
      try {
        await apiDelete(`/projects/${this.slug}/template-overrides/${this.selectedKey}`);
        const idx = this.templates.findIndex((t) => t.templateKey === this.selectedKey);
        if (idx !== -1) {
          this.templates[idx] = { ...this.templates[idx]!, hasCustomOverrides: false, values: {}, updatedAt: null };
        }
        // Re-init with empty values (falls back to all defaults)
        this.initForm(this.selectedKey, {});
        this.$q.notify({ type: "positive", message: this.$t("common.saved") as string, timeout: 2000 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.resetting = false;
      }
    },
  },
});
</script>

<style scoped>
.template-overrides-section {
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.section-header {
  padding: 20px 20px 0;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.section-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 16px;
  line-height: 1.5;
}

.loading-state {
  padding: 24px 20px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.overrides-layout {
  display: flex;
  min-height: 320px;
  border-top: 1px solid var(--border-subtle);
}

/* Left: template list */
.template-list {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
}

.template-item {
  all: unset;
  display: block;
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04));
  transition: background 0.12s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.template-item:last-child {
  border-bottom: none;
}

@media (hover: hover) and (pointer: fine) {
  .template-item:hover {
    background: var(--bg-glass);
  }
}

.template-item.active {
  background: color-mix(in srgb, var(--accent-primary, #7c5cff) 10%, transparent);
}

.template-item-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 3px;
}

.template-item-meta {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.custom-badge {
  background: color-mix(in srgb, var(--accent-primary, #7c5cff) 20%, transparent);
  color: var(--accent-primary, #7c5cff);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.defaults-label {
  color: var(--text-tertiary);
}

/* Right: editor pane */
.editor-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.no-selection {
  padding: 32px 20px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
  gap: 12px;
}

.editor-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.reset-btn {
  all: unset;
  font-size: 11px;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: color 0.12s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .reset-btn:hover {
    color: var(--text-secondary);
  }
}

.reset-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Section tabs */
.section-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 16px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.section-tab {
  all: unset;
  font-size: 12px;
  padding: 5px 10px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color 0.12s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.section-tab.active {
  color: var(--text-primary);
  background: var(--bg-glass);
  font-weight: 500;
}

@media (hover: hover) and (pointer: fine) {
  .section-tab:hover:not(.active) {
    color: var(--text-primary);
  }
}

/* Override fields */
.override-fields {
  flex: 1;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 400px;
}

/* Copy rows */
.copy-field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.copy-field-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

.locale-inputs {
  display: flex;
  gap: 8px;
}

.locale-input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 0 8px;
  min-width: 0;
}

.locale-tag {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.text-input {
  all: unset;
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  padding: 6px 0;
  min-width: 0;
}

/* Layout toggles */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  padding: 4px 0;
}

.toggle-check {
  width: 15px;
  height: 15px;
  cursor: pointer;
  accent-color: var(--accent-primary, #7c5cff);
  flex-shrink: 0;
}

/* Eligibility */
.eligibility-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eligibility-label {
  font-size: 13px;
  color: var(--text-primary);
}

.number-input {
  width: 72px;
  padding: 5px 8px;
  background: var(--bg-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  text-align: right;
}

.eligibility-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 12px 0;
}

/* Footer */
.editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  margin-top: auto;
}

.footer-status {
  font-size: 11px;
  color: var(--accent-tertiary, #ff9966);
  font-family: var(--font-mono);
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-ghost {
  all: unset;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  transition: color 0.12s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .btn-ghost:hover {
    color: var(--text-primary);
  }
}

.btn-primary {
  all: unset;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  background: var(--accent-primary, #7c5cff);
  transition: opacity 0.12s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: default;
}

@media (hover: hover) and (pointer: fine) {
  .btn-primary:not(:disabled):hover {
    opacity: 0.85;
  }
}

/* Mobile: stack columns */
@media (max-width: 767px) {
  .overrides-layout {
    flex-direction: column;
  }

  .template-list {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
    flex-direction: row;
    overflow-x: auto;
    flex-wrap: nowrap;
  }

  .template-item {
    min-width: 140px;
    border-bottom: none;
    border-right: 1px solid var(--border-subtle, rgba(255,255,255,0.04));
  }

  .locale-inputs {
    flex-direction: column;
  }
}
</style>
