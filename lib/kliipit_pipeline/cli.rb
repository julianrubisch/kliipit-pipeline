# frozen_string_literal: true

require "optparse"
require "yaml"

module KliipitPipeline
  module CLI
    def self.run(argv)
      options = parse_options(argv)
      layers = build_layers(options, argv)
      image, audio, output = resolve_paths(options, argv)

      pipeline = Pipeline.new(
        audio_path: audio, image_path: image, output_path: output,
        layers: layers, fps: options[:fps], start: options[:start],
        width: options[:width], height: options[:height],
        max_frames: options[:max_frames], max_duration: options[:max_duration],
        preview: options[:preview]
      ) do |event, *args|
        case event
        when :log
          puts "==> #{args[0]}"
        when :progress
          idx, total = args
          pct = (idx * 100) / total
          print "\r    [#{"#" * (pct / 2)}#{" " * (50 - pct / 2)}] #{pct}%"
          puts "\r    [##################################################] 100%" if idx == total - 1
        end
      end

      pipeline.run!
    end

    def self.parse_options(argv)
      options = { fps: 25, start: 0.0, preview: false }
      OptionParser.new do |opts|
        opts.banner = "Usage: kliipit-pipeline [options] [shader(s)] [image] [audio] [output]\n" \
                      "       kliipit-pipeline [options] -c composition.yml [image] [audio] [output]"
        opts.on("-n", "--frames N", Integer, "Render only N frames") { |n| options[:max_frames] = n }
        opts.on("-t", "--duration SECS", Float, "Render only SECS seconds") { |t| options[:max_duration] = t }
        opts.on("-s", "--start SECS", Float, "Start render at SECS into the audio") { |t| options[:start] = t }
        opts.on("--fps N", Integer, "Frames per second (default: 25)") { |n| options[:fps] = n }
        opts.on("-w", "--width N", Integer, "Output width (auto-detect from image)") { |n| options[:width] = n }
        opts.on("-H", "--height N", Integer, "Output height (auto-detect from image)") { |n| options[:height] = n }
        opts.on("-p", "--preview", "Also render a 2s preview around loudest moment") { options[:preview] = true }
        opts.on("-c", "--composition FILE", "YAML composition file") { |f| options[:composition] = f }
      end.parse!(argv)
      options
    end

    def self.build_layers(options, argv)
      if options[:composition]
        comp_path = File.expand_path(options[:composition])
        abort "Composition file not found: #{comp_path}" unless File.exist?(comp_path)
        comp = YAML.safe_load(File.read(comp_path), symbolize_names: true)
        abort "Composition file must have a 'layers' key" unless comp[:layers].is_a?(Array)

        comp_dir = File.dirname(comp_path)
        comp[:layers].map do |l|
          l[:end_time] = l.delete(:end) if l.key?(:end)
          l[:shader] = resolve_shader(l[:shader], comp_dir)
          Layer.new(**l)
        end
      else
        raw_shader_arg = argv[0] || "overdrive.frag"
        shader_entries = raw_shader_arg.split(",").map(&:strip).map { |s| resolve_shader(s) }
        shader_entries.each_with_index.map do |path, idx|
          Layer.new(shader: path, mode: idx == 0 ? :blend : :post)
        end
      end
    end

    def self.resolve_paths(options, argv)
      if options[:composition]
        image = File.expand_path(argv[0] || abort("Image path required"))
        audio = File.expand_path(argv[1] || abort("Audio path required"))
        output = File.expand_path(argv[2] || "output.mp4")
      else
        image = File.expand_path(argv[1] || abort("Image path required"))
        audio = File.expand_path(argv[2] || abort("Audio path required"))
        output = File.expand_path(argv[3] || "output.mp4")
      end
      [image, audio, output]
    end

    def self.resolve_shader(path, relative_to = nil)
      # Try as-is
      expanded = File.expand_path(path)
      return expanded if File.exist?(expanded)

      # Try relative to composition file directory
      if relative_to
        rel = File.expand_path(path, relative_to)
        return rel if File.exist?(rel)
      end

      # Try bundled shaders
      ShaderLoader.resolve_shader_path(path)
    end
  end
end
