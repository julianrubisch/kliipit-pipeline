# frozen_string_literal: true

require "bundler/gem_tasks"
require "minitest/test_task"

Minitest::TestTask.create

require "standard/rake"

require "rb_sys/extensiontask"

task build: :compile

GEMSPEC = Gem::Specification.load("kliipit_pipeline.gemspec")

RbSys::ExtensionTask.new("kliipit_pipeline", GEMSPEC) do |ext|
  ext.lib_dir = "lib/kliipit_pipeline"
end

task default: %i[compile test standard]
